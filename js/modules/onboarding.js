// ./js/modules/onboarding.js

export class OnboardingCarousel {
  constructor() {
    this.cards = document.querySelectorAll('.pillar-card');
    this.dots = document.querySelectorAll('.slide-dots .dot');
    this.splash = document.getElementById('splashScreen');
    this.container = document.getElementById('pillarsContainer');
    this.btnEntrarCliente = document.getElementById('btnEntrarCliente');
    this.btnDriverLink = document.querySelector('.btn-driver-link');
    
    this.currentIndex = 0;
    this.intervalId = null;
    this.touchStartX = 0;
    this.touchEndX = 0;

    this.init();
  }

  init() {
    // Se o passageiro já tiver entrado ou for motorista, encerra silenciosamente
    const jaEntrou = localStorage.getItem('huby_ja_entrou');
    const papel = localStorage.getItem('huby_user_role');
    if (jaEntrou === '1' || papel === 'motorista') {
      if (this.splash) this.splash.style.display = 'none';
      return;
    }

    if (this.cards.length > 0) {
      this.iniciarAutoPlay();
      this.configurarCliquesDots();
      this.configurarGestosSwipe();
    }

    this.configurarBotoesAcao();
  }

  // 1. NAVEGAÇÃO DOS SLIDES
  mostrarSlide(index) {
    this.cards.forEach(c => c.classList.remove('active'));
    this.dots.forEach(d => d.classList.remove('active'));

    this.currentIndex = (index + this.cards.length) % this.cards.length;

    if (this.cards[this.currentIndex]) {
      this.cards[this.currentIndex].classList.add('active');
    }
    if (this.dots[this.currentIndex]) {
      this.dots[this.currentIndex].classList.add('active');
    }
  }

  proximoSlide() {
    this.mostrarSlide(this.currentIndex + 1);
  }

  slideAnterior() {
    this.mostrarSlide(this.currentIndex - 1);
  }

  // 2. REINÍCIO DO TIMER AUTOMÁTICO
  iniciarAutoPlay() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.proximoSlide(), 3600);
  }

  pausarEReiniciarAutoPlay() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.iniciarAutoPlay();
  }

  // 3. TOQUE NAS BOLINHAS INFERIORES
  configurarCliquesDots() {
    this.dots.forEach((dot, idx) => {
      dot.addEventListener('click', () => {
        this.mostrarSlide(idx);
        this.pausarEReiniciarAutoPlay();
      });
    });
  }

  // 4. SUPORTE A SWIPE HORIZONTAL NO TOUCHSCREEN
  configurarGestosSwipe() {
    if (!this.container) return;

    this.container.addEventListener('touchstart', (e) => {
      this.touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    this.container.addEventListener('touchend', (e) => {
      this.touchEndX = e.changedTouches[0].screenX;
      this.analisarGestoSwipe();
    }, { passive: true });
  }

  analisarGestoSwipe() {
    const diferenca = this.touchStartX - this.touchEndX;
    const sensibilidadeMinima = 40; // Pixels mínimos para considerar gesto

    if (Math.abs(diferenca) > sensibilidadeMinima) {
      if (diferenca > 0) {
        // Deslize para a esquerda -> Avança
        this.proximoSlide();
      } else {
        // Deslize para a direita -> Recua
        this.slideAnterior();
      }
      this.pausarEReiniciarAutoPlay();
    }
  }

  // 5. FECHAMENTO DO ONBOARDING
  configurarBotoesAcao() {
    this.btnEntrarCliente?.addEventListener('click', () => this.fecharSplash());

    // Se clicar em ser motorista, libera navegação direta
    this.btnDriverLink?.addEventListener('click', () => {
      if (this.intervalId) clearInterval(this.intervalId);
    });
  }

  fecharSplash() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    localStorage.setItem('huby_user_role', 'cliente');
    localStorage.setItem('huby_ja_entrou', '1');

    if (this.splash) {
      this.splash.classList.add('fechado');
      setTimeout(() => {
        this.splash.style.display = 'none';
      }, 250);
    }
  }
}

// Inicialização automática ao carregar o documento
document.addEventListener('DOMContentLoaded', () => {
  window.hubyOnboarding = new OnboardingCarousel();
});