// routes/push.routes.js - Motor Oficial de Notificações Push em Segundo Plano (Web Push VAPID)
import express from 'express';
import { createRequire } from 'module';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const require = createRequire(import.meta.url);
const webpush = require('web-push');

const router = express.Router();
let vapidConfigurado = false;
let vapidPublicKeyCache = '';

export async function garantirEstruturaWebPush() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS configuracoes_plataforma (
        chave TEXT PRIMARY KEY,
        valor JSONB NOT NULL,
        atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        role VARCHAR(30) NOT NULL DEFAULT 'cliente',
        categoria VARCHAR(30) DEFAULT 'carro',
        endpoint TEXT UNIQUE NOT NULL,
        keys_json JSONB NOT NULL,
        atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    if (!vapidConfigurado) {
      let pubKey = process.env.VAPID_PUBLIC_KEY || '';
      let privKey = process.env.VAPID_PRIVATE_KEY || '';

      if (!pubKey || !privKey) {
        const reg = await sql`
          SELECT valor::text AS txt FROM configuracoes_plataforma
          WHERE chave = 'vapid_keys' LIMIT 1;
        `;

        if (reg.length && reg[0].txt) {
          let obj = reg[0].txt;
          while (typeof obj === 'string') {
            try { obj = JSON.parse(obj); } catch (e) { break; }
          }
          pubKey = obj?.publicKey || '';
          privKey = obj?.privateKey || '';
        }

        if (!pubKey || !privKey) {
          const geradas = webpush.generateVAPIDKeys();
          pubKey = geradas.publicKey;
          privKey = geradas.privateKey;
          const jsonTxt = JSON.stringify({ publicKey: pubKey, privateKey: privKey });

          await sql`
            INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
            VALUES ('vapid_keys', (${jsonTxt}::text)::jsonb, CURRENT_TIMESTAMP)
            ON CONFLICT (chave) DO UPDATE
            SET valor = (${jsonTxt}::text)::jsonb, atualizado_em = CURRENT_TIMESTAMP;
          `;
        }
      }

      webpush.setVapidDetails(
        'mailto:suporte@huby.app.br',
        pubKey,
        privKey
      );
      vapidPublicKeyCache = pubKey;
      vapidConfigurado = true;
    }
  } catch (err) {
    console.warn('Aviso ao inicializar Web Push:', err.message);
  }
}

garantirEstruturaWebPush();

// Dispara notificação push real para os motoristas online compatíveis com a corrida
export async function dispararPushParaMotoristas({ titulo, corpo, categoria, url = './motorista.html', pedidoId = null }) {
  try {
    await garantirEstruturaWebPush();
    if (!vapidConfigurado) return;

    const subs = await sql`
      SELECT ps.id, ps.endpoint, ps.keys_json, ps.usuario_id
      FROM push_subscriptions ps
      WHERE ps.role = 'motorista';
    `;

    if (!subs.length) return;

    const payload = JSON.stringify({
      titulo: titulo || '🚘 HUBy: Nova corrida disponível!',
      corpo: corpo || 'Há uma nova chamada aguardando você. Toque para aceitar.',
      url,
      pedidoId
    });

    for (const s of subs) {
      try {
        let keys = s.keys_json;
        while (typeof keys === 'string') {
          try { keys = JSON.parse(keys); } catch (e) { break; }
        }
        if (!keys?.p256dh || !keys?.auth) continue;

        await webpush.sendNotification(
          { endpoint: s.endpoint, keys },
          payload
        );
      } catch (errEnvio) {
        if (errEnvio.statusCode === 404 || errEnvio.statusCode === 410) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${s.id};`.catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('Erro ao disparar push para motoristas:', err.message);
  }
}

// Dispara push global (Broadcast do Admin)
export async function dispararPushBroadcast({ publico = 'todos', titulo, corpo }) {
  try {
    await garantirEstruturaWebPush();
    if (!vapidConfigurado) return;

    let subs;
    if (publico === 'motoristas') {
      subs = await sql`SELECT id, endpoint, keys_json FROM push_subscriptions WHERE role = 'motorista';`;
    } else if (publico === 'passageiros') {
      subs = await sql`SELECT id, endpoint, keys_json FROM push_subscriptions WHERE role = 'cliente';`;
    } else {
      subs = await sql`SELECT id, endpoint, keys_json FROM push_subscriptions;`;
    }

    const payload = JSON.stringify({
      titulo: titulo || '📢 Comunicado HUBy',
      corpo: corpo || '',
      url: publico === 'motoristas' ? './motorista.html' : './index.html'
    });

    for (const s of subs) {
      try {
        let keys = s.keys_json;
        while (typeof keys === 'string') {
          try { keys = JSON.parse(keys); } catch (e) { break; }
        }
        if (!keys?.p256dh || !keys?.auth) continue;
        await webpush.sendNotification({ endpoint: s.endpoint, keys }, payload);
      } catch (errEnvio) {
        if (errEnvio.statusCode === 404 || errEnvio.statusCode === 410) {
          await sql`DELETE FROM push_subscriptions WHERE id = ${s.id};`.catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('Erro no broadcast push:', err.message);
  }
}

// 1. Retorna a Public Key VAPID para o navegador registrar o aparelho
router.get('/vapid-public-key', async (req, res) => {
  await garantirEstruturaWebPush();
  if (!vapidPublicKeyCache) {
    return res.status(503).json({ erro: 'Chave Push ainda não inicializada.' });
  }
  res.json({ publicKey: vapidPublicKeyCache });
});

// 2. Salva/Atualiza a inscrição Push do aparelho do usuário logado
router.post('/subscribe', autenticarToken, async (req, res) => {
  try {
    await garantirEstruturaWebPush();
    const usuarioId = String(req.usuario.id);
    const role = String(req.usuario.role || 'cliente').toLowerCase();
    const categoria = String(req.usuario.categoria || 'carro').toLowerCase();
    const { subscription } = req.body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ erro: 'Objeto de inscrição Push inválido.' });
    }

    const keysTxt = JSON.stringify(subscription.keys);

    await sql`
      INSERT INTO push_subscriptions (usuario_id, role, categoria, endpoint, keys_json, atualizado_em)
      VALUES (${usuarioId}, ${role}, ${categoria}, ${subscription.endpoint}, (${keysTxt}::text)::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (endpoint) DO UPDATE
      SET usuario_id = ${usuarioId},
          role = ${role},
          categoria = ${categoria},
          keys_json = (${keysTxt}::text)::jsonb,
          atualizado_em = CURRENT_TIMESTAMP;
    `;

    res.json({ sucesso: true, mensagem: 'Notificações Push ativadas neste dispositivo!' });
  } catch (err) {
    console.error('Erro ao salvar subscription push:', err);
    res.status(500).json({ erro: 'Falha ao ativar notificações push.' });
  }
});

export default router;