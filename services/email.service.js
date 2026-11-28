// services/email.service.js - Envio de e-mails pela API do Brevo (HTTPS)
// O Render grátis bloqueia SMTP (portas 25, 465 e 587), por isso usamos a API.
// Variáveis no Render: BREVO_API_KEY e EMAIL_REMETENTE (e opcional EMAIL_NOME_REMETENTE).

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

export function emailConfigurado() {
  return Boolean(process.env.BREVO_API_KEY && process.env.EMAIL_REMETENTE);
}

export async function enviarEmail({ para, nomePara, assunto, texto, html }) {
  if (!emailConfigurado()) {
    return { enviado: false, motivo: 'E-mail não configurado (BREVO_API_KEY / EMAIL_REMETENTE).' };
  }

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 10000);

  try {
    const resp = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_NOME_REMETENTE || 'HUBy Mobilidade',
          email: process.env.EMAIL_REMETENTE
        },
        to: [{ email: para, ...(nomePara ? { name: nomePara } : {}) }],
        subject: assunto,
        htmlContent: html,
        textContent: texto
      }),
      signal: controle.signal
    });

    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      console.warn(`[email] Brevo respondeu ${resp.status}: ${corpo.slice(0, 300)}`);
      return { enviado: false, motivo: `Brevo ${resp.status}` };
    }
    return { enviado: true };
  } catch (err) {
    console.warn('[email] Falha ao enviar:', err.name === 'AbortError' ? 'tempo esgotado' : err.message);
    return { enviado: false, motivo: err.message };
  } finally {
    clearTimeout(timer);
  }
}