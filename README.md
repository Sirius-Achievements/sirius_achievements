# Техническая документация проекта «Sirius.Achievements»

**Веб-платформа учёта и управления достижениями студентов**

> Курсовой / научно-исследовательский проект
> Образовательный центр «Сириус», 2026
> Научный руководитель: Семёнов М.Е.

---

## 1. Аннотация

«Sirius.Achievements» — это полнофункциональная информационная система для подачи, модерации, учёта и аналитики студенческих достижений. Платформа автоматизирует работу с дипломами, грамотами, сертификатами и протоколами, формирует индивидуальные и сезонные рейтинги, предоставляет AI-сводку профиля студента (характеристика-рекомендация), обеспечивает трёхуровневую систему ролевой модерации и систему поддержки (тикеты + чат в реальном времени).

Система реализована как микросервисная архитектура с разделением слоёв: основное FastAPI-приложение (бизнес-логика, REST API, WebSocket), отдельный AI-микросервис (OCR на базе EasyOCR + PyMuPDF), объектное хранилище MinIO (S3-совместимое), реляционная СУБД PostgreSQL и кэш/rate-limit на базе Redis. Фронтенд — Single Page Application на React 19 + TypeScript + Vite + Tailwind CSS. Развёртывание контейнерное (Docker Compose), CI/CD — Jenkins, обратный прокси — Nginx с TLS (Let's Encrypt).

---

## 2. Цели и задачи

### Цель работы

Разработка информационной системы, обеспечивающей цифровизацию процесса учёта студенческих достижений с поддержкой ролевой модерации, геймификации, интеллектуального анализа документов и автоматического формирования характеристики-рекомендации.

### Задачи

1. Проектирование микросервисной архитектуры и реляционной модели данных.
2. Реализация системы аутентификации и авторизации с разграничением четырёх ролей и зональной модерацией.
3. Разработка модуля загрузки, валидации и трёхступенчатой модерации достижений.
4. Создание сезонной рейтинговой системы с расчётом баллов по уровням и результатам.
5. Интеграция OCR-распознавания для PDF/JPEG/PNG/WebP (грамоты, сертификаты).
6. Реализация AI-генерации характеристики студента по шаблону «характеристика-рекомендация» через YandexGPT.
7. Разработка системы поддержки с тикетами, чатом и шифрованием сообщений в покое.
8. Внедрение системы push-уведомлений через WebSocket с персистентным хранением.
9. Покрытие защитными middleware (CSRF, security-headers, rate limiting, upload protection, JWT).
10. Развёртывание в контейнерной среде Docker с Jenkins CI/CD и обратным прокси Nginx.

---

## 3. Технологический стек

### 3.1 Бэкенд

| Компонент | Технология | Версия | Назначение |
|-----------|-----------|--------|------------|
| Язык | Python | 3.11 (slim) | Серверная логика |
| Веб-фреймворк | FastAPI | 0.115.14 | REST API + WebSocket |
| ASGI-сервер | Uvicorn | 0.34.3 | Запуск приложения, 2 воркера |
| ORM | SQLAlchemy (async) | 2.0.41 | Работа с БД |
| Миграции | Alembic | 1.16.2 | Версионирование схемы |
| Валидация | Pydantic | 2.11.7 | Схемы запросов/ответов |
| JWT | PyJWT | 2.10.1 | API access/refresh-токены |
| Хеширование пароля | bcrypt | 4.2.1 | Безопасное хранение паролей |
| Шифрование (поддержка) | cryptography | 46.0.2 | AES-шифрование сообщений тикетов |
| Email (async) | aiosmtplib | 3.0.2 | Письма верификации/восстановления |
| HTTP-клиент | httpx | 0.28.1 | Вызовы YandexGPT и AI-микросервиса |
| Логирование | structlog | 24.1.0 | Структурированные JSON-логи |
| Мониторинг | Sentry SDK | 2.32.0 | Error tracking |
| Загрузка файлов | python-multipart | 0.0.20 | Multipart-парсер |
| S3 SDK | boto3 / botocore | 1.40.59 | Клиент MinIO |
| PDF | PyMuPDF | 1.24.14 | Извлечение текста из PDF |
| Обработка изображений | Pillow | 11.2.1 | Аватары, превью |

### 3.2 AI / OCR-микросервис

| Компонент | Версия | Назначение |
|-----------|--------|------------|
| FastAPI | 0.115.14 | HTTP API микросервиса |
| Uvicorn | 0.34.3 | ASGI-сервер |
| EasyOCR | 1.7.1 | OCR для JPEG/PNG/WebP |
| PyMuPDF | 1.24.14 | OCR / извлечение текста из PDF |
| Pillow | 11.2.1 | Препроцессинг изображений |

Предобученные модели:
- `craft_mlt_25k.pth` — детекция текстовых регионов (CRAFT)
- `cyrillic_g2.pth` — распознавание кириллицы

### 3.3 Базы данных и хранилище

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| СУБД | PostgreSQL | 15 (alpine) |
| Драйвер sync | psycopg2-binary | 2.9.10 |
| Драйвер async | asyncpg | ≥ 0.30.0 |
| Кэш / rate-limit | Redis | 7 (alpine) |
| Объектное хранилище | MinIO | latest (S3 API) |

### 3.4 Фронтенд

| Компонент | Технология | Версия |
|-----------|-----------|--------|
| UI-библиотека | React | 19.2.4 |
| Маршрутизация | React Router DOM | 7.13.2 |
| Сборщик | Vite | 5.4.19 |
| Язык | TypeScript | 5.7.3 |
| Стили | Tailwind CSS | 4.2.2 |
| HTTP-клиент | axios | 1.13.6 |
| Графики | Chart.js + react-chartjs-2 | 4.5.1 / 5.3.1 |
| PDF-рендер | pdf.js | 5.6.205 |
| Кроп аватара | cropperjs | 1.6.2 |

### 3.5 Инфраструктура и DevOps

| Компонент | Технология |
|-----------|-----------|
| Контейнеризация | Docker, Docker Compose |
| Обратный прокси | Nginx (alpine) |
| TLS | Let's Encrypt (volumes mount) |
| CI/CD | Jenkins LTS |
| Тестирование | pytest, pytest-asyncio |
| Базовые образы | python:3.11-slim, node:20-slim |

---

## 4. Архитектура системы

### 4.1 Высокоуровневая схема

```
┌────────────┐  HTTPS/WSS   ┌──────────────────────────────────────────┐
│            │ ───────────► │                Nginx                      │
│  Браузер   │              │  (TLS, обратный прокси, rate limiting)    │
│ (React SPA)│ ◄─────────── │                                            │
└────────────┘              └──────────────────┬───────────────────────┘
                                                │
                                  ┌─────────────┴───────────────┐
                                  │                             │
                                  ▼                             ▼
                       ┌────────────────────┐      ┌────────────────────┐
                       │   FastAPI app       │      │   FastAPI ai-svc   │
                       │  (Uvicorn, 2 wk)    │      │   (Uvicorn)        │
                       │  ─ middlewares      │      │   ─ /ocr           │
                       │  ─ REST API v1      │      │   ─ /health        │
                       │  ─ WS notifications │      └────────────────────┘
                       │  ─ schema migration │                ▲
                       └─┬─────┬─────┬─────┬┘                │
                  async  │     │     │     │ httpx           │
                         ▼     ▼     ▼     ▼                  │
              ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────────┘
              │PostgreSQL│ │ Redis  │ │ MinIO  │ │
              │   15     │ │   7    │ │  S3    │ │
              └──────────┘ └────────┘ └────────┘ │
                                                  │
                                          ┌───────┴────────┐
                                          │   YandexGPT    │
                                          │  Cloud (HTTPS) │
                                          └────────────────┘
```

### 4.2 Слои бэкенда

Приложение организовано по принципу слоёв:

1. **Routers** (`app/routers/api/v1/`) — HTTP-эндпоинты (валидация запроса/ответа через Pydantic).
2. **Services** (`app/services/`, `app/services/admin/`) — бизнес-логика (модерация, генерация резюме, работа с тикетами).
3. **Repositories / DB-helpers** — слой доступа к данным (часть запросов выполняется напрямую в сервисах через SQLAlchemy).
4. **Models** (`app/models/`) — SQLAlchemy ORM-модели.
5. **Infrastructure** (`app/infrastructure/`) — БД-движок, JWT, логгер, переводы.
6. **Middlewares** (`app/middlewares/`) — CSRF, безопасность, защита загрузок, JWT-проверка для API.
7. **Utils** (`app/utils/`) — пароли, MinIO-хранилище, rate-limiter, валидация файлов, шифрование.

---

## 5. Модель данных (PostgreSQL)

### 5.1 Сущности

| Таблица | Модель | Назначение |
|---------|--------|------------|
| `users` | `Users` | Пользователи (студенты, модераторы, админы) |
| `achievements` | `Achievement` | Поданные достижения (документ + метаданные) |
| `support_tickets` | `SupportTicket` | Обращения в поддержку |
| `support_messages` | `SupportMessage` | Сообщения в чате тикета (шифруются в покое) |
| `notifications` | `Notification` | Уведомления (хранятся, доставляются по WS) |
| `user_tokens` | `UserToken` | Серверные токены: верификация e-mail, сброс пароля |
| `pages` | `Page` | CMS-страницы (правила, политика, FAQ) |
| `audit_logs` | `AuditLog` | Журнал изменений и действий персонала |
| `season_results` | `SeasonResult` | Зафиксированные результаты по завершённому сезону |
| `user_notes` | `UserNote` | Внутренние заметки модераторов о пользователях |

### 5.2 Ключевые поля `Users`

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | int PK | |
| `first_name`, `last_name` | str | Имя и фамилия |
| `email` | str unique | Логин и канал верификации |
| `hashed_password` | str | bcrypt-хэш |
| `phone_number` | str? | Телефон |
| `avatar_path` | str? | Путь к аватару (MinIO key или локальный) |
| `role` | enum `UserRole` | GUEST / STUDENT / MODERATOR / SUPER_ADMIN |
| `status` | enum `UserStatus` | pending / active / rejected / deleted |
| `education_level` | enum `EducationLevel` | Колледж / Бакалавриат / Специалитет / Магистратура / Аспирантура |
| `course` | int? | Курс обучения |
| `study_group` | str? | Учебная группа (например, ИОП-ИТ-25/1) |
| `moderator_courses` / `moderator_groups` | str? | CSV-список зон модерации |
| `session_gpa` | str? | Средний балл сессии |
| `session_version` | int | Инкрементируется при инвалидации сессии |
| `api_access_version` / `api_refresh_version` | int | Инвалидация JWT |
| `failed_attempts` / `blocked_until` | int / dt | Защита от перебора |
| `resume_text` / `resume_generated_at` | text / dt | Кэш AI-резюме |
| `reviewed_by_id` | FK → users.id | Модератор, проверивший пользователя |

### 5.3 Ключевые поля `Achievement`

| Поле | Тип | Описание |
|------|-----|----------|
| `user_id` | FK | Автор достижения |
| `title` / `description` | str / text | Название и описание |
| `file_path` | str? | Путь к документу (MinIO или локально) |
| `external_url` | str? | Альтернатива файлу — внешняя ссылка |
| `category` | enum `AchievementCategory` | Спорт / Наука / Искусство / Волонтёрство / Хакатон / Патриотизм / Проекты / Другое |
| `level` | enum `AchievementLevel` | Школьный / Муниципальный / Региональный / Федеральный / Международный |
| `result` | enum `AchievementResult` | Участник / Призёр / Победитель |
| `points` | int | Рассчитанные баллы (`level × result`) |
| `status` | enum `AchievementStatus` | pending / approved / rejected / revision / archived |
| `rejection_reason` | text? | Причина отклонения / замечания |
| `moderator_id` | FK → users.id | Кто взял в работу |

### 5.4 Перечисления (`app/models/enums.py`)

- `UserRole` — `GUEST`, `STUDENT`, `MODERATOR`, `SUPER_ADMIN`.
- `UserStatus` — `pending`, `active`, `rejected`, `deleted`.
- `AchievementStatus` — `pending`, `approved`, `rejected`, `revision`, `archived`.
- `AchievementCategory` — Спорт, Наука, Искусство, Волонтёрство, Хакатон, Патриотизм, Проекты, Другое.
- `AchievementLevel` — Школьный, Муниципальный, Региональный, Федеральный, Международный.
- `AchievementResult` — Участник, Призёр, Победитель.
- `EducationLevel` — Колледж, Бакалавриат, Специалитет, Магистратура, Аспирантура.
- `UserTokenType` — `access`, `refresh`, `reset_password`, `verify_email`.
- `SupportTicketStatus` — `open`, `in_progress`, `closed`, `archived`.

### 5.5 Расчёт баллов

Базовая шкала по уровню (`app/config.py`):

| Уровень | Баллы | ENV-переменная |
|---------|-------|----------------|
| Школьный | 10 | `POINTS_SCHOOL` |
| Муниципальный | 20 | `POINTS_MUNICIPAL` |
| Региональный | 40 | `POINTS_REGIONAL` |
| Федеральный | 75 | `POINTS_FEDERAL` |
| Международный | 100 | `POINTS_INTERNATIONAL` |

Множитель по результату (×100, чтобы не использовать float):

| Результат | Множитель |
|-----------|-----------|
| Участник | 0.50 |
| Призёр | 0.75 |
| Победитель | 1.00 |

Итоговые баллы рассчитываются в `app/utils/points.py` и фиксируются в `Achievement.points` при одобрении модератором.

---

## 6. Управление миграциями БД

Используется **Alembic**. Скрипты лежат в `app/migrations/versions/`:

- `3fb740c4328e_users.py` — базовая схема `users`.
- `b116bbedfefc_add_missing_tables.py` — недостающие таблицы.
- `2f2e4cddad31_add_education_level_and_course_to_users.py` — учёбные поля.
- `6c9b81bed305_create_user_tokens_table.py` — серверные токены.
- `add_support_tables.py`, `add_support_ticket_assignment.py`, `add_support_ticket_lifecycle.py` — служба поддержки.
- `75b155daab71_add_resume_text_to_users.py`, `add_resume_generated_at.py` — AI-резюме.
- `add_user_security_state.py` — версии сессий и API-токенов (инвалидация).
- `add_audit_logs.py` — журнал аудита.
- `25279d38c60e_add_season_results.py` — сезонные итоги.
- `add_moderator_scope.py` — зональная модерация.
- `620951dcc34a_create_pages_table.py` — CMS.
- `fix_enums.py`, `add_missing_enum_values.py`, `add_new_categories.py` — корректировка перечислений.
- `add_rejection_reason.py`, `update_schema_v1.py` — точечные исправления.

Помимо Alembic в `main.py` есть **идемпотентная страховочная функция** `_apply_schema_updates()`, выполняющая `ALTER TABLE ... IF NOT EXISTS ...` и нормализацию enum-значений после прогона миграций. Это обеспечивает совместимость со средами, где схема была частично применена вручную (production).

Команды:

```bash
# Создать новую миграцию
docker exec sirius_app_new alembic revision --autogenerate -m "описание"

# Применить миграции
docker exec sirius_app_new alembic upgrade head

# Откатить
docker exec sirius_app_new alembic downgrade -1
```

---

## 7. REST API (v1)

Все API-эндпоинты находятся в `app/routers/api/v1/` и включаются в FastAPI через `app/routers/api/v1/__init__.py`. Аутентификация — JWT (access + refresh).

| Файл | Назначение |
|------|------------|
| `auth.py` | Логин, регистрация, верификация e-mail, refresh-токенов, восстановление пароля |
| `public.py` | Публичные эндпоинты (CMS-страницы, профили публичного просмотра) |
| `achievements.py` | CRUD достижений студента |
| `documents.py` | Управление прикреплёнными документами |
| `profile.py` | Профиль текущего пользователя |
| `points.py` | Информация о баллах и шкале |
| `leaderboard.py` | Глобальный и фильтруемый рейтинг + экспорт CSV |
| `dashboard.py` | Сводка для административной панели |
| `moderation.py` | Модерация достижений и пользователей |
| `moderation_support.py` | Модераторские действия в системе поддержки |
| `support.py` | Тикеты и чат поддержки (студент) |
| `users.py` | Управление пользователями |
| `my_work.py` | «Моя работа» — назначения текущего модератора |
| `notifications.py` | Получение и пометка уведомлений |
| `user_notes.py` | Внутренние заметки модератора о пользователях |
| `reports.py` | Отчёты и аналитика |
| `media.py` | Раздача и обработка медиа из MinIO |
| `serializers.py` | Общие Pydantic-схемы и сериализаторы |

#### Полный список endpoint'ов (по фактическому коду)

**Аутентификация (`api/v1/auth.py`):**

```
POST /api/v1/auth/login                       — JSON-логин
POST /api/v1/auth/session-login               — Логин для веб-сессии
POST /api/v1/auth/logout                      — Завершение сессии
POST /api/v1/auth/refresh                     — Обновление access-токена
POST /api/v1/auth/register                    — Регистрация
POST /api/v1/auth/verify-email                — Подтверждение e-mail
POST /api/v1/auth/resend-verify-email         — Повторная отправка письма
POST /api/v1/auth/forgot-password             — Запрос сброса пароля
POST /api/v1/auth/verify-code                 — Проверка кода
POST /api/v1/auth/resend-code                 — Повтор кода
POST /api/v1/auth/reset-password              — Сброс пароля
GET  /api/v1/auth/me                          — Текущий пользователь
```

**Достижения и документы:**

```
GET    /api/v1/achievements                   — Список достижений
GET    /api/v1/achievements/search            — Поиск
POST   /api/v1/achievements                   — Подача нового
PATCH  /api/v1/achievements/{id}              — Доработка после возврата
DELETE /api/v1/achievements/{id}              — Удаление
GET    /api/v1/documents                      — Список документов
GET    /api/v1/documents/{id}/preview         — Превью PDF/изображения
GET    /api/v1/documents/{id}/download        — Скачивание
DELETE /api/v1/documents/{id}                 — Удаление
```

**Профиль и баллы:**

```
GET   /api/v1/profile                         — Профиль текущего
PATCH /api/v1/profile                         — Обновление профиля
POST  /api/v1/profile/change-password         — Смена пароля
POST  /api/v1/profile/delete-account          — Запрос удаления
GET   /api/v1/profile/public/{user_id}        — Публичный профиль
GET   /api/v1/points/rules                    — Шкала баллов
```

**Рейтинг:**

```
GET  /api/v1/leaderboard                      — Рейтинг с фильтрацией
GET  /api/v1/leaderboard/export               — Экспорт CSV
POST /api/v1/leaderboard/end-season           — Завершение сезона
```

**Модерация достижений и пользователей:**

```
GET   /api/v1/moderation/pending-users
POST  /api/v1/moderation/users/{id}/approve
POST  /api/v1/moderation/users/{id}/reject
POST  /api/v1/moderation/users/{id}/take
POST  /api/v1/moderation/users/{id}/release
GET   /api/v1/moderation/pending-achievements
POST  /api/v1/moderation/achievements/{id}/take
POST  /api/v1/moderation/achievements/{id}/release
PATCH /api/v1/moderation/achievements/{id}/metadata
PATCH /api/v1/moderation/achievements/{id}/status
POST  /api/v1/moderation/achievements/batch
```

**Поддержка (студент):**

```
GET  /api/v1/support/tickets                  — Список своих тикетов
POST /api/v1/support/tickets                  — Создание тикета
GET  /api/v1/support/tickets/{id}             — Переписка
POST /api/v1/support/tickets/{id}/message     — Отправить сообщение
POST /api/v1/support/tickets/{id}/close       — Закрыть
```

**Поддержка (модератор):**

```
GET  /api/v1/moderation/support/queue
GET  /api/v1/moderation/support/chats
GET  /api/v1/moderation/support/search
GET  /api/v1/moderation/support/all
GET  /api/v1/moderation/support/{id}
POST /api/v1/moderation/support/{id}/take
POST /api/v1/moderation/support/{id}/message
POST /api/v1/moderation/support/{id}/close
POST /api/v1/moderation/support/{id}/reopen
```

**Дашборд, уведомления, моя работа:**

```
GET  /api/v1/dashboard                        — Сводка по роли
GET  /api/v1/dashboard/inbox-counts           — Счётчики «Входящих»
GET  /api/v1/my-work/overview                 — Назначения модератора
GET  /api/v1/notifications/unread-count       — Кол-во непрочитанных
POST /api/v1/notifications/mark-read          — Отметить прочитанным
```

**Публичные:**

```
GET /api/v1/public/config                     — Публичная конфигурация
GET /api/v1/public/pages/{slug}               — CMS-страница
```

Health-check: `GET /health` — проверяет доступность БД, отвечает `200`/`503`.

OpenAPI (Swagger UI / ReDoc) автоматически отключаются в `production` (см. `main.py`).

### 7.1 WebSocket

| Endpoint | Назначение |
|----------|------------|
| `WS /ws/notifications` | Получение уведомлений в реальном времени |

Авторизация WS:

1. Сначала проверяется session-cookie (если запрос с того же origin).
2. Если cookie нет — берётся JWT из subprotocol или query-параметра `?token=...`.
3. Origin строго сверяется со списком `ALLOWED_HOSTS` (rejection при отсутствии Origin-заголовка).
4. Сверяется `session_version` / `api_access_version` пользователя — если admin принудительно вышел из всех сессий, существующие WS-соединения закрываются.

Менеджер соединений: `app/services/ws_manager.py`.

---

## 8. Аутентификация и авторизация

### 8.1 Дуальная модель сессий

- **Web (SPA)** — серверные сессии через Starlette `SessionMiddleware`, хранятся в подписанной cookie. Версионируются через `users.session_version`.
- **API (мобильные/внешние клиенты)** — JWT с парой access/refresh. Версионируются через `users.api_access_version` и `users.api_refresh_version`.

Это позволяет принудительно завершить все сессии пользователя (например, при подозрении на компрометацию) инкрементом одного счётчика.

### 8.2 JWT (`app/infrastructure/jwt_handler.py`)

- Подпись HMAC-SHA256 по `SECRET_KEY`.
- Поля: `sub` (user id), `type` (`access` / `refresh`), `av` (access version), `rv` (refresh version), `exp`.
- Refresh-токены ротируются: после успешного `/refresh` старый токен инвалидируется поднятием `api_refresh_version`.

### 8.3 Роли

| Роль | Возможности |
|------|-------------|
| `GUEST` | Регистрация, верификация e-mail (после неё статус → `STUDENT`) |
| `STUDENT` | Подача достижений, просмотр своего рейтинга и профиля, обращения в поддержку |
| `MODERATOR` | Модерация в пределах своей зоны (курсы/группы), чат поддержки, приём в работу |
| `SUPER_ADMIN` | Все права, завершение сезонов, управление пользователями и CMS |

### 8.4 CSRF

- Реализация `app/security/csrf.py`.
- Токен генерируется в сессии и записывается в cookie `XSRF-TOKEN` (доступна JS, samesite=lax).
- На небезопасных методах (POST/PUT/PATCH/DELETE) проверяется заголовок `X-CSRF-Token`.

### 8.5 Восстановление пароля и верификация

- Одноразовые токены через `user_tokens` таблицу (тип `verify_email`, `reset_password`).
- Письмо отправляется через `aiosmtplib` (`SMTP TLS/STARTTLS`).
- Срок жизни токенов и количество попыток ограничены (см. rate-limiter).

---

## 9. Безопасность

### 9.1 Стек middleware (порядок применения, см. `main.py`)

1. `SessionMiddleware` — сессии (HTTPS-only в production).
2. `ProxyHeadersMiddleware` (`uvicorn`) — `X-Forwarded-*` парсятся только от доверенных прокси (`TRUSTED_PROXY_IPS`).
3. `TrustedHostMiddleware` (`fastapi`) — `Host` сверяется с `ALLOWED_HOSTS`.
4. `FlashToastMiddleware` — управление toast-уведомлениями через query-параметры (с одноразовой записью в сессию).
5. `CSRFContextMiddleware` — выдача и обновление XSRF cookie.
6. `UploadProtectionMiddleware` — лимиты на загрузки и проверка multipart.
7. `SecurityHeadersMiddleware` — X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, CSP.

### 9.2 Лимиты загрузки (`app/config.py`)

| Тип файла | Лимит | Переменная |
|-----------|-------|------------|
| Аватар | 2 МБ | `MAX_AVATAR_SIZE` |
| Документ достижения | 10 МБ | `MAX_DOC_SIZE` |
| Файл поддержки | 5 МБ | `MAX_SUPPORT_FILE_SIZE` |

Дополнительно валидируется MIME-тип и расширение (`app/utils/file_validator.py`); JPEG/PNG/WebP/PDF — только разрешённые форматы.

### 9.3 Rate Limiting

Реализовано на Redis (`app/utils/rate_limiter.py`). По умолчанию:

| Сценарий | Попыток | Окно |
|----------|---------|------|
| Вход (web) | 5 | 15 мин (`LOGIN_LOCKOUT_TTL=900`) |
| Вход (API) | 10 | 15 мин |
| Refresh-токен | 20 | 15 мин |
| Восстановление пароля | 5 | 15 мин |
| Подтверждение OTP | 5 | 15 мин |
| Регистрация | 5 | 1 час |
| Загрузка файлов | 20 | 1 час (`UPLOAD_RATE_TTL=3600`) |

### 9.4 Шифрование сообщений поддержки

`app/utils/support_crypto.py` — симметричное шифрование текста и вложений в `support_messages` через `cryptography.fernet` (или эквивалент). Ключ — переменная окружения; в БД хранятся только зашифрованные данные. См. коммит `d993070 feat: encrypt support chat messages and attachments at rest`.

### 9.5 Журнал аудита

- Модель `AuditLog` (`app/models/audit_log.py`).
- Сервис записи: `app/services/audit_service.py`.
- Логируются: действия модератора (одобрение/отклонение, взятие в работу, возврат), CMS-правки, входы/выходы admin-учёток, изменения ролей и зон.
- Каждая запись содержит `action`, `target_type`, `target_id`, `actor_id`, `ip_address`, `user_agent`, `created_at`.

### 9.6 Безопасные секреты

- `SECRET_KEY` обязателен в production (`main.py` поднимает `ValueError` при отсутствии или дефолтном значении).
- `.env` не попадает в репозиторий (`.gitignore`).

---

## 10. Сервисный слой бэкенда

### 10.1 `app/services/` (кросс-доменные)

| Файл | Описание |
|------|----------|
| `auth_service.py` | Регистрация, верификация, логин, refresh, сброс пароля |
| `audit_service.py` | Запись событий в `audit_logs` |
| `points_calculator.py` | Расчёт баллов по уровню и результату достижения |
| `ws_manager.py` | Менеджер активных WebSocket-соединений (broadcast + per-user) |

### 10.2 `app/services/admin/`

| Файл | Описание |
|------|----------|
| `user_service.py` | CRUD пользователей, смена ролей, блокировка, изменение зон модерации |
| `achievement_service.py` | Модерация достижений: одобрение, отклонение, возврат на доработку, назначение |
| `resume_service.py` | OCR-извлечение текста + AI-генерация характеристики (YandexGPT + локальный fallback) |
| `support_service.py` | Управление тикетами, назначение модераторов, отправка сообщений |
| `support_maintenance.py` | Фоновая задача: автозакрытие тикетов после `SUPPORT_ARCHIVE_AFTER_DAYS=90` |
| `page_service.py` | CMS-страницы (правила, политика) |
| `user_token_service.py` | Управление одноразовыми токенами |
| `base_crud_service.py` | Базовый CRUD-класс |

### 10.3 Репозитории (`app/repositories/admin/`)

Слой доступа к данным реализован паттерном **Repository** поверх SQLAlchemy `AsyncSession`. Все CRUD-операции инкапсулированы и переиспользуются сервисами.

| Файл | Сущность | Основные операции |
|------|----------|-------------------|
| `base.py` | — | Базовый async-репозиторий |
| `base_crud_repository.py` | — | Generic-CRUD: `create`, `read`, `update`, `delete`, `list` |
| `crud_repository.py` | — | Тонкая обёртка над базовым |
| `user_repository.py` | `Users` | `get_by_email`, `get` (фильтры по name/email/phone, role, status), сортировка, пагинация |
| `achievement_repository.py` | `Achievement` | Фильтры по `status`, `user_id`, `category`, поиск |
| `support_repository.py` | `SupportTicket`, `SupportMessage` | Фильтры по `status`, `user_id`, `moderator_id` |
| `user_token_repository.py` | `UserToken` | Поиск по `token`, `user_id`, `type` |
| `page_repository.py` | `Page` | Поиск по `slug`, фильтр опубликованных |

### 10.4 Pydantic-схемы (`app/schemas/admin/`)

| Файл | Сущность | Основные классы |
|------|----------|-----------------|
| `auth.py` | Auth | `LoginPayload`, `RegisterPayload`, `ResetPasswordSchema` |
| `users.py` | Users | `UserCreate`, `UserUpdate`, `UserResponse` |
| `achievements.py` | Achievement | `AchievementCreate`, `AchievementUpdate`, `AchievementResponse` |
| `user_tokens.py` | UserToken | `UserTokenCreate` |
| `pages.py` | Page | `PageCreate`, `PageUpdate` |

### 10.5 Утилиты

| Файл | Описание |
|------|----------|
| `app/utils/storage.py` | Работа с MinIO/S3: upload, download, presigned URL, удаление, проверка пути (`is_minio_path`) |
| `app/utils/password.py` | bcrypt-хэширование и проверка |
| `app/utils/rate_limiter.py` | Декораторы и хелперы поверх Redis для блокировок |
| `app/utils/notifications.py` | Создание уведомления + рассылка в WS-менеджер |
| `app/utils/file_validator.py` | Проверка MIME, расширения, magic-bytes |
| `app/utils/access.py` | Проверка прав модератора в его зоне (course/group) |
| `app/utils/support_sessions.py` | Управление сроком жизни активных тикетов (день/неделя/месяц) |
| `app/utils/support_crypto.py` | Шифрование/расшифровка текста сообщений и метаданных вложений |
| `app/utils/optimizer.py` | Оптимизация изображений (Pillow) для аватаров и превью |
| `app/utils/search.py` | Полнотекстовая нормализация для поиска по русскоязычным полям |
| `app/utils/media_paths.py` | Резолвинг путей `static/...` в реальные файлы |
| `app/utils/education.py` | Сопоставление `EducationLevel` ↔ метки UI |
| `app/utils/points.py` | Чистая функция расчёта итогового балла |

---

## 11. AI-подсистема

### 11.1 Архитектура

```
   Студент
     │ загружает PDF/JPG/PNG
     ▼
 FastAPI app  ──────────►  MinIO (S3)
     │                          │
     │ (по запросу AI-резюме)   │
     ▼                          ▼
 ResumeService.generate_resume()
     │
     ├──► AI-микросервис /ocr (httpx, multipart)
     │        ├── PyMuPDF (PDF)
     │        └── EasyOCR  (изображение)
     │
     └──► YandexGPT API
              │
              └─► Текст характеристики (по шаблону)
```

### 11.2 OCR-микросервис (`ai-service/`)

- Отдельный контейнер (`ai_service:8001`).
- Эндпоинт `POST /ocr` принимает `multipart/form-data` с одним файлом, возвращает `{"text": "..."}`.
- Для PDF — `PyMuPDF`, для изображений — `EasyOCR` (русский язык, инициализация при старте).
- Healthcheck: `GET /health`.
- Модели OCR хранятся на томе `./models:/app/easyocr_models` и не загружаются автоматически из интернета (`RESUME_OCR_MODEL_DOWNLOAD_ENABLED=false`).

### 11.3 Сервис резюме (`app/services/admin/resume_service.py`)

Алгоритм:

1. **Доступ.** `can_generate(user_id)` проверяет: пользователь существует, есть подтверждённые достижения, и со времени последней генерации появились новые подтверждённые документы.
2. **Сбор материала.** По всем `Achievement` со статусом `APPROVED` строится `docs_data` (категория, уровень, баллы, дата, описание + OCR-текст из файла).
3. **OCR.** Если у достижения есть файл — он скачивается из MinIO/локального диска и отправляется в AI-микросервис. Поддерживаются `.jpg, .jpeg, .png, .webp, .pdf`. Извлечённый текст ограничен `OCR_TEXT_LIMIT=6000` и санитизируется.
4. **Генерация AI.** Если YandexGPT настроен (`RESUME_EXTERNAL_AI_ENABLED=true` + `YANDEX_API_KEY` + `YANDEX_FOLDER_ID` без плейсхолдеров) — отправляется промпт в `https://llm.api.cloud.yandex.net/foundationModels/v1/completion` (модель `yandexgpt`).
5. **Локальный fallback.** Если AI недоступен — формируется детерминированная сводка по шаблону (категории, уровни, перечень достижений, итоговая фраза).
6. **Сохранение.** Результат пишется в `users.resume_text` + `users.resume_generated_at` для последующего быстрого отображения и контроля «новизны».

Шаблон характеристики-рекомендации (см. образец в `СтепановТА_достижения.docx`):

```
ХАРАКТЕРИСТИКА-РЕКОМЕНДАЦИЯ

ФИО студента: <Фамилия Имя>
Курс: <N>, группа: <study_group>
Специальность: <education_level + специальность>
Квалификация: <квалификация>
Средний балл: <session_gpa>

<Описательный абзац о студенте, генерируемый AI>

<Перечень достижений по категориям/уровням>

Научный руководитель: Семёнов М.Е.
```

Управляющие переменные окружения:

| Переменная | Назначение |
|------------|------------|
| `YANDEX_API_KEY` | Ключ Yandex Cloud |
| `YANDEX_FOLDER_ID` | Идентификатор каталога |
| `RESUME_EXTERNAL_AI_ENABLED` | Включить YandexGPT |
| `RESUME_SUPERVISOR` | Имя научрука (по умолчанию «Семёнов М.Е.») |
| `RESUME_SPECIALTY_DEFAULT` | Специальность по умолчанию |
| `RESUME_QUALIFICATION_DEFAULT` | Квалификация по умолчанию |
| `AI_SERVICE_URL` | URL OCR-микросервиса (`http://ai_service:8001`) |
| `AI_SERVICE_TIMEOUT` | Таймаут OCR (сек) |

---

## 12. Объектное хранилище (MinIO / S3)

- Контейнер `sirius_minio`, образ `minio/minio:latest`, тома `minio_data:/data`.
- API-порт `9000`, консоль `9001` (биндятся только на `127.0.0.1`).
- Бакет создаётся идемпотентно при старте приложения (`ensure_bucket()` в `main.py:lifespan`).
- Учётные данные через `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` (фиксируются в `.env`).
- Загрузка из приложения — `app/utils/storage.py` (boto3-клиент). Файлы достижений и аватары хранятся как S3-объекты (а не на диске контейнера).
- Доступ из браузера — через подписанные временные ссылки (presigned URL) либо через прокси-эндпоинт в `media.py`.

---

## 13. Уведомления

- Persistence: таблица `notifications` (заголовок, текст, ссылка, признак прочтения).
- Доставка: WebSocket `/ws/notifications` (см. п. 7.1) + REST для подгрузки истории.
- Создание: `app/utils/notifications.py` (фасад: создаёт запись + рассылает в `ws_manager`).
- На клиенте: `frontend/src/contexts/NotificationContext.tsx`.

Триггерные события:

- Подача достижения — модератору соответствующей зоны.
- Решение по модерации (одобрено/отклонено/на доработке) — студенту.
- Новое сообщение в тикете — соответствующей стороне.
- Назначение тикета на модератора.
- Завершение сезона.

---

## 14. Фоновые задачи

В `main.py:lifespan` стартует один долгоживущий `asyncio.Task`:

- `_support_maintenance_loop()` — каждый час вызывает `process_support_ticket_maintenance(db)`, который:
  - Архивирует тикеты со `status=closed`, перешедшие за `SUPPORT_ARCHIVE_AFTER_DAYS=90` дней.
  - Закрывает тикеты с истёкшим `session_expires_at` (день/неделя/месяц по выбору пользователя).
  - Логирует статистику в structlog.

Дополнительные фоновые задачи на cron не используются — расчёт баллов и обновление рейтинга происходят синхронно при модерации.

---

## 15. Фронтенд (React 19 SPA)

### 15.1 Структура `frontend/src/`

```
frontend/src/
├── main.tsx                          # Точка входа
├── App.tsx                           # Роутер + provider'ы (Auth/Theme/Notification/Toast)
├── contexts/
│   ├── AuthContext.tsx               # Auth-состояние, login/logout/refresh
│   ├── ThemeContext.tsx              # Светлая/тёмная тема
│   ├── ToastContext.tsx              # Глобальные toast-уведомления
│   └── NotificationContext.tsx       # WebSocket-канал уведомлений
├── components/
│   ├── layout/{AppLayout,AuthLayout,Header,Sidebar,MobileNav,navigation}.tsx
│   ├── ui/{Button,Badge,Card,Input,Modal,Pagination,LoadingSpinner,
│   │       EmptyState,StatCard,ToastViewport,ConfirmDialog,
│   │       PdfViewer,DocumentPreviewImage,ThemeToggle,PaginationFooter}.tsx
│   ├── points/PointsGuide.tsx
│   └── staff/{SearchAutocompleteInput,StaffSectionHeader}.tsx
└── pages/
    ├── auth/         (Login, Register, ForgotPassword, ResetPassword,
    │                  VerifyEmail, VerifyCode, Privacy)
    ├── errors/       (NotFoundPage, ForbiddenPage, ServerErrorPage)
    ├── dashboard/    DashboardPage
    ├── leaderboard/  LeaderboardPage
    ├── profile/      ProfilePage
    ├── achievements/ AchievementsPage
    ├── documents/    DocumentsPage
    ├── my-work/      MyWorkPage
    ├── moderation/   (ModerationAchievementsPage, ModerationUsersPage,
    │                  ModerationSupportPage, ModerationSupportChatPage,
    │                  ModerationAchievementsPage)
    ├── support/      (SupportPage, SupportChatPage)
    ├── users/        (UsersPage, UserDetailPage)
    └── public/       StudentProfilePage
```

### 15.2 Маршрутизация и сборка

- Маршруты `/sirius.achievements/app/...` обслуживаются SPA. Бэкенд отдаёт `static/spa/index.html` для всех путей (catch-all в `main.py:spa_catch_all`).
- Билд: `npm run build` → TypeScript-компиляция + Vite-бандл → `static/spa/`.
- В Dockerfile используется multi-stage build: `node:20-slim` → собранный SPA → копируется в финальный python-образ.

### 15.3 API-клиент и хуки

```
frontend/src/api/
├── client.ts           # axios-инстанс, перехватчики (Bearer, refresh, redirect 401)
├── auth.ts             # login, logout, refresh, register, verify, forgot/reset
├── profile.ts          # профиль, смена пароля
├── achievements.ts     # CRUD достижений
├── documents.ts        # документы / превью / скачивание
├── leaderboard.ts      # рейтинг + экспорт
├── moderation.ts       # модерация
├── support.ts          # тикеты студента
├── users.ts            # управление пользователями
├── reports.ts          # отчёты
├── public.ts           # публичные эндпоинты
├── points.ts           # шкала баллов
├── notifications.ts    # уведомления
├── myWork.ts           # «Моя работа»
└── dashboard.ts        # дашборд

frontend/src/hooks/
├── useAuth.ts          # обёртка над AuthContext
├── useTheme.ts         # переключение темы
├── useToast.ts         # toast-уведомления
├── useNotifications.ts # WebSocket-уведомления
└── useInboxCounts.ts   # счётчики «Входящих»
```

### 15.4 Темизация

- Поддержаны светлая и тёмная палитры.
- Анимированный переключатель `ThemeToggle` (солнце/луна).
- Выбор сохраняется в `localStorage`.
- Конфигурация цветов — через `static/theme/theme.conf`.

### 15.5 Email-шаблоны

В `templates/emails/` находятся 5 файлов:

| Файл | Назначение |
|------|------------|
| `base.html` | Базовый каркас письма (шапка, подвал, стили) |
| `verify_email.html` / `verify_email.txt` | Подтверждение e-mail (HTML + текст) |
| `reset_password.html` / `reset_password.txt` | Сброс пароля (HTML + текст) |

Письма рендерятся через Jinja2 в `auth_service.py` и отправляются асинхронно через `aiosmtplib` (TLS/STARTTLS, см. конфигурацию `MAIL_*` в `.env`). HTML-версия передаётся как `multipart/alternative` вместе с текстовой для совместимости с любыми почтовыми клиентами.

---

## 16. Конфигурация (`.env`)

Полный шаблон — `.env.example`. Обязательные переменные:

| Переменная | Описание |
|------------|----------|
| `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL |
| `REDIS_PASSWORD` | Redis (требуется при запуске) |
| `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | MinIO |
| `SECRET_KEY` | Сессии и подпись JWT (≥32 байта random) |
| `ALLOWED_HOSTS` | CSV список разрешённых хостов |
| `TRUSTED_PROXY_IPS` | CSV CIDR доверенных прокси (для X-Forwarded-*) |
| `MAIL_HOST`, `MAIL_USERNAME`, `MAIL_PASSWORD` | SMTP |
| `ENV` | `development` / `production` |
| `DEBUG` | Включает /docs |

Опциональные (AI-резюме):

| `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `RESUME_EXTERNAL_AI_ENABLED` |

Все остальные параметры (rate-limit, points, лимиты файлов) имеют адекватные значения по умолчанию в `app/config.py`.

---

## 17. Развёртывание

### 17.1 Контейнерный стек (`docker-compose.yml`)

| Контейнер | Образ | Порты | Назначение |
|-----------|-------|-------|------------|
| `sirius_db_new` | `postgres:15-alpine` | 127.0.0.1:5433→5432 | СУБД |
| `sirius_redis_new` | `redis:7-alpine` | — (внутренний) | Кэш, rate-limit, сессии |
| `sirius_minio` | `minio/minio:latest` | 127.0.0.1:9000, 9001 | Объектное хранилище |
| `sirius_ai_service` | build `./ai-service` | — (внутренний 8001) | OCR-микросервис |
| `sirius_app_new` | build `.` | 127.0.0.1:8081→8000 | Главное приложение |
| `sirius_nginx` | `nginx:alpine` | 80, 443 | TLS, обратный прокси |
| `jenkins` | `jenkins/jenkins:lts` | через сеть `jenkins_net` | CI/CD |

Сети: `prod_net` (приложение + БД + хранилище) и `jenkins_net` (CI). Все сервисы стартуют в зависимости от `service_healthy` БД, Redis и MinIO.

### 17.2 Запуск

```bash
git clone <repo>
cd sirius_achievements
cp .env.example .env             # заполнить SECRET_KEY, БД, Redis, MinIO, SMTP
docker compose up -d --build
docker exec sirius_app_new alembic upgrade head
docker exec sirius_app_new python app/seeders/main.py   # опционально
```

После старта: `https://<домен>/sirius.achievements/app/login` (или `http://localhost/` при локальной разработке через nginx).

### 17.3 CI/CD (Jenkins)

- `Jenkinsfile` в корне репозитория.
- Шаги: checkout → build образов → запуск pytest → деплой через `docker compose up -d --build` → smoke-тесты `/health`.
- Jenkins работает с примонтированным `/var/run/docker.sock` (управляет хост-Docker).

### 17.4 Nginx

- Конфигурация в `nginx/conf.d/`.
- Статические сертификаты Let's Encrypt монтируются read-only из `/etc/letsencrypt`.
- Upstream → `web:8000`.
- Раздача статики `/static/...` идёт через приложение (FastAPI `StaticFiles`), но в production имеет смысл вынести её на nginx.

---

## 18. Тестирование

- Каркас: pytest 8.4.1 + pytest-asyncio 1.1.0.
- Конфигурация: `pytest.ini`, `conftest.py` (общие фикстуры — БД, клиент, авторизация).
- Структура: `app/tests/unit/` (юнит-тесты), `app/tests/unit/admin/` (тесты сервисного слоя).

**Покрытие (20 тест-файлов):**

| Файл | Что покрывает |
|------|---------------|
| `test_auth_service.py` | `AuthService.api_authenticate`, генерация токенов |
| `test_config.py` | Корректность загрузки `Settings` |
| `test_file_validator.py` | MIME-тип, расширение, лимит размера загрузки |
| `test_page_service.py` | CRUD CMS-страниц |
| `test_points_calculator.py` | Расчёт баллов по уровню × результат |
| `test_rate_limiter.py` | Инкремент/сброс/проверка Redis-лимитов |
| `test_support_service.py` | Создание тикетов, отправка сообщений |
| `test_support_sessions.py` | Истечение срока активного тикета |
| `test_support_ticket_model.py` | Поведение модели |
| `test_user_model.py` | Свойства `Users` (роли, статус) |
| `test_user_service.py` | Регистрация, обновление профиля |
| `test_user_token_service.py` | Генерация и валидация одноразовых токенов |
| `test_escape_like.py` | Безопасность LIKE-запросов |
| `test_resume_service.py` | OCR + AI-резюме (моки) |
| `test_serializers.py` | Сериализация ответов |
| `test_reset_demo_dataset.py` | Сценарий сброса демо-данных |
| `test_ws_manager.py` | Коннект/дисконнект WebSocket-менеджера |

Запуск:

```bash
docker exec sirius_app_new pytest app/tests/ -v
```

---

## 19. Логирование и мониторинг

- **structlog** инициализируется в `app/infrastructure/logger.py` — JSON в production, человекочитаемый формат в development.
- Уровень: `DEBUG` в development, `INFO` в production.
- **Sentry SDK** (`sentry-sdk==2.32.0`) подключается при наличии `SENTRY_DSN` для отлова исключений.
- Глобальный обработчик `@app.exception_handler(Exception)` логирует ошибку и возвращает HTML-страницу 500.
- Health-check: `GET /health` → 200 OK / 503 (если БД недоступна).

---

## 20. Безопасность зависимостей (по результатам аудита, май 2026)

В рамках подготовки к ревью кибербезопасности проведён аудит. Критические обновления (CVE-2025…/2026…):

| Пакет | Текущая | Требуется | Уязвимость |
|-------|---------|-----------|------------|
| `cryptography` | 46.0.2 | ≥ 46.0.7 | CVE-2026-39892 (переполнение буфера в `Hash.update`) |
| `Pillow` | 11.2.1 | 12.2.0 | CVE-2026-25990 (OOB write), CVE-2026-40192 (decompression bomb) |
| `starlette` | 0.46.2 | ≥ 0.49.1 | CVE-2025-62727 (ReDoS Range), CVE-2025-54121 (multipart DoS) |
| `python-multipart` | 0.0.20 | ≥ 0.0.26 | CVE-2026-40347 (multipart DoS) |
| `urllib3` | 2.5.0 | ≥ 2.6.3 | CVE-2026-21441, CVE-2025-66418 |
| `axios` | 1.13.6 | 1.15.1 | CVE-2026-40175 (HTTP response splitting → SSRF) |
| `vite` | 5.4.19 | 7.3.2 / 8.0.5 | 5.x EOL — патчи не бэкпортируются |
| `jenkins:lts` | floating | ≥ 2.541.3 | CVE-2026-33001/33002/42520 |

Дополнительно рекомендуется обновить `Werkzeug` 3.1.3 → 3.1.5, `PyMuPDF` 1.24.14 → 1.26.7, `requests`, `sentry-sdk`, заменить `minio:latest` на фиксированный digest, пересобрать образы `postgres:15-alpine` (≥ 15.17), `python:3.11-slim`, `node:20-slim`, `nginx:alpine` для применения патчей дистрибутивов.

---

## 21. Структура репозитория

```
sirius_achievements/
├── app/
│   ├── config.py                       # Settings (env-based)
│   ├── infrastructure/                 # database.py, jwt_handler.py, logger.py, …
│   ├── middlewares/                    # security_headers, upload_protection, …
│   ├── migrations/versions/            # Alembic-миграции (20+ файлов)
│   ├── models/                         # 11 ORM-сущностей + enums
│   ├── routers/api/v1/                 # REST API
│   ├── security/csrf.py                # CSRF-токены
│   ├── seeders/                        # Тестовые данные
│   ├── services/                       # ws_manager, audit_service, points_calculator, auth_service
│   │   └── admin/                      # resume_service, achievement_service, support_service, …
│   ├── tests/                          # pytest
│   └── utils/                          # storage, password, rate_limiter, …
├── ai-service/                         # OCR-микросервис (FastAPI + EasyOCR + PyMuPDF)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                           # React 19 SPA
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
├── models/                             # Предобученные модели OCR
│   ├── craft_mlt_25k.pth
│   └── cyrillic_g2.pth
├── nginx/                              # Конфиги обратного прокси
├── static/
│   ├── spa/                            # Собранный React-бандл
│   ├── uploads/                        # Локальные загрузки (на случай отсутствия MinIO)
│   └── theme/                          # CSS/JS темной темы
├── templates/                          # Email-шаблоны
├── main.py                             # Точка входа FastAPI
├── docker-compose.yml
├── Dockerfile                          # Multi-stage (Node-build + Python-runtime)
├── Dockerfile.jenkins
├── Jenkinsfile
├── alembic.ini
├── entrypoint.sh
├── conftest.py
├── pytest.ini
├── requirements.txt
├── .env.example
└── README.md
```

---

## 22. Команды и операции

| Действие | Команда |
|----------|---------|
| Поднять стек | `docker compose up -d --build` |
| Логи приложения | `docker logs sirius_app_new -f` |
| Применить миграции | `docker exec sirius_app_new alembic upgrade head` |
| Создать миграцию | `docker exec sirius_app_new alembic revision --autogenerate -m "msg"` |
| Откатить миграцию | `docker exec sirius_app_new alembic downgrade -1` |
| Запустить тесты | `docker exec sirius_app_new pytest app/tests/ -v` |
| Подключиться к БД | `docker exec -it sirius_db_new psql -U <user> -d <db>` |
| Подключиться к Redis | `docker exec -it sirius_redis_new redis-cli -a <password>` |
| Перезапустить только web | `docker compose restart web` |

---

## 23. Перспективы развития

1. Расширение AI-подсистемы: классификация документов, автоматическая категоризация, извлечение ключевых сущностей (даты, организаторы, призовые места).
2. Интеграция с СДО (LMS) для импорта учебных рейтингов и среднего балла.
3. Мобильный клиент на React Native поверх существующего REST API.
4. Расширение журнала аудита до полноценного SIEM-канала (Sentry → ELK / Loki).
5. Автоматизация SBOM и регулярного CVE-сканирования (Trivy, Grype) в Jenkins.
6. Внедрение Content-Security-Policy с nonce-ами для встраиваемых скриптов.

---

## 24. Контакты

- Научный руководитель: **Семёнов М.Е.**
- Исполнитель: студент 1-го курса, группа ИОП-ИТ-25/1, ИТ-специалитет.
- Репозиторий: указывается на титульной странице отчёта.

---

*Документ автоматически собран по состоянию исходного кода на май 2026 г.*
