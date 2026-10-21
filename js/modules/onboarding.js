// ./js/modules/onboarding.js

export class OnboardingCarousel {
  constructor() {
    this.cards = document.querySelectorAll('.pillar-card');
    this.dots = document.querySelectorAll('.slide-dots .dot');
    this.splash = document.getElementById('splashScreen');
    this.btnEntrarCliente = document.getElementById('btnEntrarCliente');
    this.currentIndex = 0;
    this.intervalId = null;

    this.init();
  }

  init() {
    if (this.cards.length > 0) {
      this.iniciarAutoPlay();
    }

    this.btnEntrarCliente?.addEventListener('click', () => this.fecharSplash());
  }

  proximoSlide() {
    this.cards.forEach(c => c.classList.remove('active'));
    this.dots.forEach(d => d.classList.remove('active'));

    this.currentIndex = (this.currentIndex + 1) % this.cards.length;

    this.cards[this.currentIndex].classList.add('active');
    if (this.dots[this.currentIndex]) {
      this.dots[this.currentIndex].classList.add('active');
    }
  }

  iniciarAutoPlay() {
    this.intervalId = setInterval(() => this.proximoSlide(), 3500);
  }

  fecharSplash() {
    localStorage.setItem('huby_user_role', 'cliente');
    localStorage.setItem('huby_ja_entrou', '1');
    if (this.splash) {
      this.splash.classList.add('fechado');
      this.splash.style.display = 'none';
    }
  }
}