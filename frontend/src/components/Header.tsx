interface HeaderProps {
  itemCount: number;
  onOpenCart: (trigger: HTMLButtonElement) => void;
}

export default function Header({ itemCount, onOpenCart }: HeaderProps) {
  return (
    <>
      <a className="skip-link" href="#catalog">Pular para o cardápio</a>
      <div className="academic-banner">Projeto acadêmico · RF001 · Demonstração local</div>
      <header className="site-header">
        <div className="container header-content">
          <a className="brand" href="#inicio" aria-label="Rústika Estúdio Bar, início">
            <img className="brand-symbol" src={`${import.meta.env.BASE_URL}rustika/rustika-simbolo.png`} alt="" width="216" height="320" />
            <span className="brand-name">RÚSTIKA<small>ESTÚDIO BAR</small></span>
          </a>
          <a className="header-menu-link" href="#catalog">Explorar cardápio <span aria-hidden="true">↗</span></a>
          <button className="header-cart-button" type="button" aria-haspopup="dialog" onClick={(event) => onOpenCart(event.currentTarget)} aria-label="Abrir carrinho">Carrinho <span aria-label={`${itemCount} ${itemCount === 1 ? 'unidade' : 'unidades'}`}>{itemCount}</span></button>
        </div>
      </header>

      <section className="hero container" aria-labelledby="hero-title" id="inicio">
        <div className="hero-copy">
          <p className="eyebrow">Uma nova forma de explorar o nosso menu</p>
          <h1 id="hero-title"><span className="hero-title-kicker">Bem-vindo ao</span>Rústika<span className="hero-title-subtitle">Estúdio Bar</span></h1>
          <p className="hero-description">
            Das porções aos drinks, encontre as opções do Rústika em um só lugar.
            Conheça o cardápio, explore as categorias e confira cada combinação.
          </p>
          <a className="primary-link" href="#catalog">Abrir o menu <span aria-hidden="true">↓</span></a>
          <p className="hero-note">Porções <span aria-hidden="true">·</span> Drinks <span aria-hidden="true">·</span> Cervejas</p>
        </div>
        <figure className="hero-art">
          <span className="hero-stamp" aria-hidden="true">MENU<span>RÚSTIKA</span></span>
          <div className="hero-photo-frame">
            <img src={`${import.meta.env.BASE_URL}rustika/rustika-palco.jpg`} alt="Palco do Rústika com bateria, microfones e iluminação colorida." width="1000" height="443" fetchPriority="high" />
          </div>
          <figcaption className="hero-caption"><strong>A essência do Rústika.</strong><span>Fotografia do estabelecimento, presente no cardápio original.</span></figcaption>
        </figure>
      </section>
    </>
  );
}
