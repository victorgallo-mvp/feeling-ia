// src/servicos/audio.js
// Transcrição de gravações de reunião. Papel do cockpit: arquivo (converter, fatiar, juntar).
// Papel do n8n: a IA (webhook N8N_WEBHOOK_TRANSCREVER recebe um trecho e devolve { texto }).
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const exec = promisify(execFile);

const EXTENSOES_AUDIO = ['.mp3', '.m4a', '.wav', '.ogg', '.opus', '.aac', '.flac', '.mp4', '.webm', '.mov', '.mkv'];
const TRECHO_SEG = 10 * 60; // 10 min por trecho: bem abaixo do limite de 25 MB do Whisper e do payload do n8n
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';

const ehAudio = (nome) => EXTENSOES_AUDIO.includes(path.extname(nome || '').toLowerCase());
const transcricaoConfigurada = () => Boolean(process.env.N8N_WEBHOOK_TRANSCREVER);

// Converte para mono 16 kHz mp3 32 kbps (1 h ≈ 14 MB) e corta em trechos. Devolve os caminhos dos trechos.
async function prepararTrechos(buffer, nomeOriginal, dir) {
  const entrada = path.join(dir, `entrada${path.extname(nomeOriginal).toLowerCase() || '.bin'}`);
  await fs.writeFile(entrada, buffer);
  const padrao = path.join(dir, 'trecho-%03d.mp3');
  await exec(ffmpeg, [
    '-v', 'error', '-y', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(TRECHO_SEG), '-reset_timestamps', '1', padrao,
  ], { maxBuffer: 1024 * 1024 });
  const nomes = (await fs.readdir(dir)).filter((n) => /^trecho-\d+\.mp3$/.test(n)).sort();
  if (!nomes.length) throw new Error('o ffmpeg não conseguiu ler áudio desse arquivo');
  return nomes.map((n) => path.join(dir, n));
}

async function transcreverTrecho(caminho, indice, total) {
  const FormData = require('form-data');
  const form = new FormData();
  form.append('arquivo', await fs.readFile(caminho), { filename: path.basename(caminho), contentType: 'audio/mpeg' });
  form.append('parte', String(indice + 1));
  form.append('total', String(total));
  const resp = await axios.post(process.env.N8N_WEBHOOK_TRANSCREVER, form, { timeout: 300000, headers: form.getHeaders(), maxBodyLength: Infinity });
  if (resp.data?.erro) throw new Error(resp.data.erro);
  const texto = String(resp.data?.texto || '').trim();
  if (!texto) throw new Error(`o trecho ${indice + 1}/${total} voltou vazio do n8n`);
  return texto;
}

// Gravação -> texto corrido. `aoProgresso(i, total)` é opcional (log).
async function transcreverGravacao(buffer, nomeOriginal, aoProgresso) {
  if (!transcricaoConfigurada()) throw new Error('N8N_WEBHOOK_TRANSCREVER não configurado');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reuniao-'));
  try {
    const trechos = await prepararTrechos(buffer, nomeOriginal, dir);
    const partes = [];
    for (let i = 0; i < trechos.length; i++) {
      aoProgresso?.(i, trechos.length);
      partes.push(await transcreverTrecho(trechos[i], i, trechos.length)); // em série: ordem garantida e sem estourar o n8n
    }
    return { texto: partes.join('\n\n'), trechos: trechos.length };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { ehAudio, transcricaoConfigurada, transcreverGravacao, EXTENSOES_AUDIO };
