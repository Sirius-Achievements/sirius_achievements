// Decorative desktop-only hero panel for the auth pages (login / register /
// password flows). Purely presentational — no data, no logic. Hidden on mobile
// so the phone layout stays exactly as before.

const FEATURES = [
  {
    title: 'Портфолио достижений',
    subtitle: 'Загружай дипломы, сертификаты и проекты',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.42A12 12 0 0112 21a12 12 0 01-6.16-10.42L12 14z"
      />
    ),
  },
  {
    title: 'Живой рейтинг',
    subtitle: 'Соревнуйся в своём потоке и глобально',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" />
    ),
  },
  {
    title: 'Проверка модераторами',
    subtitle: 'Каждое достижение подтверждено',
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    ),
  },
]

export function AuthHero() {
  return (
    <div className="auth-hero hidden lg:flex">
      <div className="auth-hero__grid" aria-hidden />
      <span className="auth-hero__orb auth-hero__orb--1" aria-hidden />
      <span className="auth-hero__orb auth-hero__orb--2" aria-hidden />
      <span className="auth-hero__orb auth-hero__orb--3" aria-hidden />

      <div className="auth-hero__content">
        <div className="auth-hero__brand">
          <span className="auth-hero__brand-badge">
            <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path
                d="M12 3l2.4 5.2L20 9.3l-4 4 1 5.7L12 16.6 7 19l1-5.7-4-4 5.6-1.1L12 3z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="auth-hero__brand-text">Сириус · Достижения</span>
        </div>

        <h2 className="auth-hero__title">
          Все твои достижения — <span>в одном месте</span>
        </h2>
        <p className="auth-hero__subtitle">
          Портфолио, рейтинг и признание для студентов Университета «Сириус».
        </p>

        <div className="auth-hero__cards">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="auth-hero__card">
              <span className="auth-hero__card-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="22" height="22">
                  {feature.icon}
                </svg>
              </span>
              <span className="auth-hero__card-text">
                <span className="auth-hero__card-title">{feature.title}</span>
                <span className="auth-hero__card-sub">{feature.subtitle}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
