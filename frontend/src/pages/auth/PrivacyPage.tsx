import { Link } from 'react-router-dom'

const DATA_ROWS = [
  ['Профиль', 'Имя, фамилия, email, телефон, фотография, курс и группа', 'Пока существует аккаунт; после подтверждённого запроса данные удаляются или обезличиваются с учётом обязательных журналов безопасности.'],
  ['Достижения', 'Описание, категория, файлы, статус, баллы, комментарии модератора', 'Пока документ нужен для текущего или завершённого рейтингового сезона. Документ, повлиявший на рейтинг, сначала архивируется.'],
  ['Поддержка', 'Текст сообщений, вложения, автор и время отправки', 'Закрытые обращения переводятся в архив через 90 дней и хранятся до удаления аккаунта или отдельного запроса.'],
  ['Безопасность', 'История входов, технические идентификаторы сессий, IP и события изменения доступа', 'В объёме, необходимом для расследования ошибок, защиты аккаунта и аудита действий сотрудников.'],
  ['Epoch / Emercom', 'Запись интерфейса с маскировкой полей, клики, ошибки консоли, сетевые события и ID сессии', 'В отдельном сервисе аналитики согласно его настройкам хранения. ID прикрепляется к баг-репорту, чтобы открыть нужную запись.'],
]

export function PrivacyPage() {
  return (
    <article className="theme-auth-card w-full max-w-4xl rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm sm:p-8">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600">Sirius.Achievements</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-800">Политика конфиденциальности</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          Редакция 1.0 от 20 августа 2026 года. Документ объясняет, какие данные использует сервис,
          зачем они нужны и как пользователь может управлять ими.
        </p>
      </header>

      <div className="mt-6 space-y-8 text-sm leading-relaxed text-slate-600">
        <section>
          <h2 className="text-lg font-semibold text-slate-800">1. Какие данные хранятся и как долго</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[720px] w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Раздел</th><th className="px-4 py-3">Состав данных</th><th className="px-4 py-3">Срок и порядок хранения</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {DATA_ROWS.map(([title, data, retention]) => (
                  <tr key={title} className="align-top">
                    <th className="px-4 py-3 font-semibold text-slate-800">{title}</th>
                    <td className="px-4 py-3">{data}</td>
                    <td className="px-4 py-3">{retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
            Архивирование не означает немедленное удаление. Если для отдельной категории не настроен автоматический
            срок удаления, данные хранятся до удаления аккаунта, отдельного решения администратора или обоснованного запроса пользователя.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <h2 className="font-semibold text-slate-800">2. Для чего используются данные</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>создание профиля и подтверждение личности автора;</li><li>проверка достижений и расчёт рейтинга;</li>
              <li>поддержка пользователей и уведомления;</li><li>защита аккаунтов, аудит действий и исправление ошибок;</li>
              <li>формирование разрешённых пользователем публичных страниц.</li>
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <h2 className="font-semibold text-slate-800">3. Кто имеет доступ</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>студент — к собственным данным и разрешённым публичным полям;</li>
              <li>модератор — к закреплённым заявкам, документам и служебным заметкам;</li>
              <li>суперадминистратор — к данным, необходимым для управления и аудита;</li>
              <li>операторы Epoch/Emercom — к диагностическим записям в пределах выданного доступа.</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-800">4. Диагностика Epoch / Emercom</h2>
          <p className="mt-2">Сервис помогает восстановить последовательность действий перед ошибкой. При отправке баг-репорта платформа сохраняет ID диагностической сессии, адрес страницы, версию приложения, браузер и устройство. По этому ID сотрудник с разрешённым доступом открывает запись интерфейса, ошибки консоли и сетевые события рядом с моментом обращения.</p>
          <p className="mt-2">Поля ввода и чувствительное содержимое должны маскироваться сборщиком. Пароли, коды подтверждения и содержимое загружаемых документов не предназначены для аналитической записи. Доступ к диагностике не делает профиль публичным.</p>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-slate-800">5. Удаление данных и контакт</h2>
          <p className="mt-2">Запрос на удаление, исправление или выгрузку данных можно создать в разделе «Поддержка» личного кабинета, выбрав категорию «Аккаунт». Если войти невозможно, ответьте на последнее служебное письмо платформы и укажите email аккаунта. Администрация Sirius.Achievements является контактной точкой по таким обращениям.</p>
          <p className="mt-2 text-xs text-slate-500">Перед удалением потребуется подтвердить владение аккаунтом. Часть обезличенных записей аудита может сохраняться, если это необходимо для безопасности, расследования инцидента или целостности завершённого рейтингового сезона.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-800">6. Изменения политики</h2>
          <p className="mt-2">При существенном изменении состава данных, сроков хранения или диагностических инструментов версия и дата документа обновляются. Для изменений, влияющих на права пользователя, в интерфейсе показывается отдельное уведомление.</p>
        </section>
      </div>

      <footer className="mt-8 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row">
        <Link to="/register" className="inline-flex flex-1 items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700">Понятно, вернуться к регистрации</Link>
        <Link to="/login" className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">Перейти ко входу</Link>
      </footer>
    </article>
  )
}
