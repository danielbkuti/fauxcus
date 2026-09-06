<p align="center">
  <img src="docs/logo.png" alt="Fauxcus" width="360">
</p>

<h1 align="center">Task Management App (Django + DRF + React + Docker)</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11-blue" alt="Python">
  <img src="https://img.shields.io/badge/Django-6.x-green" alt="Django">
  <img src="https://img.shields.io/badge/React-Vite-61DAFB" alt="React">
  <img src="https://img.shields.io/badge/Docker-Containerized-blue" alt="Docker">
  <img src="https://img.shields.io/badge/PostgreSQL-Database-blue" alt="PostgreSQL">
</p>

## Overview

Fauxcus is a full-stack task management app: a Django REST Framework API backing a React (Vite) frontend, running in Docker. It tracks tasks and subtasks with deadlines, surfaces urgency through a state-driven visual system (on-track / due-soon / overdue / completed), and layers in the kind of small-scale polish — completion celebrations, scroll-reveal animations, live progress stats — that a plain CRUD task list usually skips.

This project demonstrates:

- Full-stack REST API design (DRF backend, React frontend consuming it over session-cookie auth)
- Relational data modeling with cascading completion logic
- A real digit-code email verification signup flow, with rate limiting
- State-driven UI architecture (one deadline-derived theme drives a card's colors, banners, and animations)
- Containerized development environment
- Automated backend testing

### Live demo

**[fauxcus-api.onrender.com](https://fauxcus-api.onrender.com)**

Log in with `demo@example.com` / `DemoPass123!` to see a seeded account with real tasks and subtasks in every deadline state. It's hosted on Render's free tier, so the first request after a period of inactivity can take about a minute to spin the container back up — later requests are fast.

---

# Architecture

```
React frontend (Vite)
        ↓
Django REST API (DRF)
        ↓
PostgreSQL
        ↓
Docker Containers
```

Components:

| Layer | Technology |
|------|------------|
| Frontend | React (Vite), Tailwind v4, shadcn/ui |
| Backend | Django |
| API | Django REST Framework |
| Database | PostgreSQL |
| Containerization | Docker |
| Authentication | Custom Django user model, session-cookie auth |
| Testing | Django + DRF Test Framework |

---

# Features

### Frontend
- Landing page with a live animated task-list preview
- Dashboard: animated welcome header, streak tracking, "Upcoming" list pulled from tasks and subtasks alike
- Task list: filter/sort, bulk select and complete/delete, live date search, scroll-reveal card animations
- Task detail page: a four-state color theme (on-track / due-soon / overdue / completed) driving the whole page's palette, a progress dial, an activity log, and celebration animations (confetti, fireworks) on completion
- Deadline editor: a portal-based wheel picker (day/month/year, optional time-of-day), shared across every place a deadline gets set
- Progress page: a status breakdown bar, weekly activity chart, and a GitHub-style daily-activity heatmap doubling as a streak visual

### Authentication
- Custom user model
- Digit-code email verification signup (6-digit code, attempt cap, expiry)
- Login via username or email
- Password reset by email
- Per-IP and per-account rate limiting on auth endpoints

### Task Management
- Create/update/delete tasks and subtasks
- Deadlines with date and optional time-of-day
- Automatic parent-task completion propagation from subtasks
- Per-task activity log (created, renamed, completed/reopened, deadline changes)

### API
- RESTful endpoints
- Filtering
- Ordering
- Pagination
- User-scoped data access

### Infrastructure
- Dockerized development environment
- PostgreSQL container
- Environment variable configuration

### Data Integrity
- Unique task name per user
- Relational task/subtask consistency
- Serializer validation

### Testing
- API tests
- Model integrity tests
- Authentication tests

---

# Screenshots

### Landing page
![Landing page](docs/screenshot-landing.png)

### Dashboard
![Dashboard](docs/screenshot-dashboard.png)

### Task list
![Task list](docs/screenshot-tasklist.png)

### Task detail

The same page in two of its four deadline-driven states — in progress (purple, "far" from due) and completed (green) — showing how the palette, banner, and primary action all come from one state rather than being set independently.

![Task detail — in progress](docs/screenshot-taskdetail2.png)
![Task detail — completed](docs/screenshot-taskdetail.png)

### Progress
![Progress](docs/screenshot-progress.png)

---

# API Endpoints
```
- GET /api/tasks/
- POST /api/tasks/
- GET /api/tasks/{id}/
- PUT /api/tasks/{id}/
- DELETE /api/tasks/{id}/

- GET /api/subtasks/
- POST /api/subtasks/
```

 ### Filtering Example

```
/api/tasks/?completed=true
```

### Ordering Example

```
/api/tasks/?ordering=dateCreated
```

---

# Running the Project

### 1. Clone the Repository

```bash
git clone <repo-url>
cd flexmaster
```

---

### 2. Create Environment Files

Backend — create a `.env` in the project root:

```
DEBUG=True

POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_HOST=db
POSTGRES_PORT=5432

SECRET_KEY=your-secret-key
ALLOWED_HOSTS=localhost,127.0.0.1
FRONTEND_URL=http://localhost:3000
```

Frontend — create `frontend/.env`:

```
VITE_API_BASE_URL=http://localhost:8637
```

---

### 3. Build Docker Containers

```bash
docker-compose up --build
```

---

### 4. Run Database Migrations

```bash
docker-compose exec web python manage.py migrate
```

---

### 5. Run the Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
```

---

### 6. Access the Application

Frontend:

```
http://localhost:3000
```

Backend API root:

```
http://localhost:8637/api/
```

---

# Running Tests

Execute tests inside the Docker container:

```bash
docker-compose exec web python manage.py test
```

---

# Engineering Decisions

### Custom User Model

Allows authentication flexibility and supports future extensibility for user profiles and permissions.

### REST API + Session-Cookie Auth

The backend exposes a RESTful API using Django REST Framework, consumed by the React frontend over session-cookie authentication rather than tokens.

### Subtask Completion Propagation

Task completion state automatically updates based on the completion status of associated subtasks.

### State-Driven UI

A task's deadline (overdue / due-soon / on-track, plus completed) is the single source of truth for its color palette, banner, and animation across both the task list and the task detail page — no state is duplicated or hand-synced between the two.

### UTC Date Handling

All timestamps are stored in UTC to prevent timezone inconsistencies across clients.

### Dockerized Environment

Docker ensures a consistent development environment and simplifies dependency management.

---

# Future Improvements

- Goals and Calendar pages (currently placeholders)
- JWT authentication
- Asynchronous email processing (Celery)
- Production deployment (AWS / Fly / Railway)

---

# License

MIT — see [LICENSE](LICENSE). Built for educational and portfolio purposes.
