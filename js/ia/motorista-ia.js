// js/ia/motorista-ia.js - Assistente Operacional e Respostas Rápidas para o Motorista
import { API_URL } from '../config.js';

class HUByMotoristaIA {
  constructor() {
    this.containerSugestoes = null;
    this.ultimaMensagemProcessada = null;
  }

  // Inicializa o observador do chat do motorista
  iniciar() {
    this.criarContainerSugestoes();
    this.monitorarMensagensChat();
  }

  // Cria a barra horizontal onde aparecem os botões de 1 toque
  criarContainerSugestoes() {
    const areaInputChat = document.querySelector('.chat-input-row');
    if (!areaInputChat || document.getElementById('hubySmartRepliesBar')) return;

    this.containerSugestoes = document.createElement('div');
    this.containerSugestoes.id = 'hubySmartRepliesBar';
    this.containerSugestoes.className = 'huby-smart-replies-bar';
    this.containerSugestoes.style.display = 'none';

    // Insere a barra logo acima do campo de digitação
    areaInputChat.parentNode.insertBefore(this.containerSugestoes, areaInputChat);
  }

  // Observa mudanças nas mensagens para sugerir respostas
  monitorarMensagensChat() {
    const areaMsgs = document.getElementById('chatAreaMensagens');
    if (!areaMsgs) return;

    const observer = new MutationObserver(() => {
      const mensagens = areaMsgs.querySelectorAll('.chat-area-messages > div');
      if (!mensagens.length) return;

      const ultimaMsgEl = mensagens[mensagens.length - 1];
      // Verifica se a mensagem veio do passageiro (não enviada pelo motorista)
      const ehDoPassageiro = !ultimaMsgEl.style.alignSelf.includes('flex-end');
      const textoMensagem = ultimaMsgEl.innerText.trim();

      if (ehDoPassageiro && textoMensagem !== this.ultimaMensagemProcessada) {
        this.ultimaMensagemProcessada = textoMensagem;
        this.obterSugestoesResposta(textoMensagem);
      }
    });

    observer.observe(areaMsgs, { childList: true, subtree: true });
  }

  // Chama o backend para gerar as respostas rápidas
  async obterSugestoesResposta(textoPassageiro) {
    try {
      const token = localStorage.getItem('huby_token');
      const res = await fetch(`${API_URL}/api/ia/motorista-respostas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ mensagem: textoPassageiro })
      });

      if (!res.ok) return;
      const data = await res.json();

      if (data.sucesso && Array.isArray(data.sugestoes)) {
        this.renderizarSugestoes(data.sugestoes);
      }
    } catch (err) {
      console.warn('⚠️ Falha ao obter Smart Replies da IA:', err.message);
    }
  }

  // Renderiza as pílulas clicáveis no chat
  renderizarSugestoes(sugestoes) {
    if (!this.containerSugestoes) this.criarContainerSugestoes();
    if (!this.containerSugestoes) return;

    this.containerSugestoes.innerHTML = '';

    if (!sugestoes.length) {
      this.containerSugestoes.style.display = 'none';
      return;
    }

    sugestoes.forEach((texto) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'huby-reply-pill';
      btn.textContent = texto;

      btn.addEventListener('click', () => {
        const inputChat = document.getElementById('inputChatMsg');
        const btnEnviar = document.getElementById('btnEnviarMsgChat');

        if (inputChat && btnEnviar) {
          inputChat.value = texto;
          btnEnviar.click();
          this.containerSugestoes.style.display = 'none';
        }
      });

      this.containerSugestoes.appendChild(btn);
    });

    this.containerSugestoes.style.display = 'flex';
  }

  // Síntese por voz do ponto de embarque ao motorista aceitar a corrida
  narrarPontoEmbarque(endereco, observacao = '') {
    if (!('speechSynthesis' in window)) return;

    let textoNarracao = `Embarque em: ${endereco}.`;
    if (observacao && observacao.trim()) {
      textoNarracao += ` Atenção passageiro informou: ${observacao}.`;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(textoNarracao);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.05;
    window.speechSynthesis.speak(utterance);
  }
}

export const motoristaIA = new HUByMotoristaIA();