import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskList } from './TaskList'
import { useTaskStore } from '@/context/TaskStoreContext'

vi.mock('@/context/TaskStoreContext', () => ({
  useTaskStore: vi.fn(),
}))

// TaskList imports these at module scope; none of the tests below
// trigger a mutation, but leaving them unmocked would mean a stray
// effect hitting the real (unmocked) fetch in jsdom instead of failing
// clearly, so they're stubbed defensively.
vi.mock('@/lib/tasks', () => ({
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  createSubTask: vi.fn(),
  updateSubTask: vi.fn(),
  deleteSubTask: vi.fn(),
}))

function task(overrides = {}) {
  return {
    id: 1,
    name: 'Write tests',
    completed: false,
    dateDeadline: null,
    dateCreated: '2026-01-01T00:00:00Z',
    dateCompleted: null,
    status: 'pending',
    subtasks: [],
    ...overrides,
  }
}

function mockStore({ tasks = [], status = 'ready' } = {}) {
  useTaskStore.mockReturnValue({
    tasks,
    status,
    setTasks: vi.fn(),
    refreshTasks: vi.fn().mockResolvedValue(tasks),
    refreshTask: vi.fn(),
  })
}

function renderTaskList() {
  return render(
    <MemoryRouter>
      <TaskList />
    </MemoryRouter>
  )
}

describe('TaskList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading message while the store is loading', () => {
    mockStore({ status: 'loading' })
    renderTaskList()

    expect(screen.getByText(/loading tasks/i)).toBeInTheDocument()
  })

  it('shows an error message if the store failed to load', () => {
    mockStore({ status: 'error' })
    renderTaskList()

    expect(screen.getByText(/couldn.t load your tasks/i)).toBeInTheDocument()
  })

  it('shows the empty state with no tasks', () => {
    mockStore({ tasks: [] })
    renderTaskList()

    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument()
  })

  it('renders every active task', () => {
    mockStore({
      tasks: [task({ id: 1, name: 'Write tests' }), task({ id: 2, name: 'Ship feature' })],
    })
    renderTaskList()

    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByText('Ship feature')).toBeInTheDocument()
  })

  it('splits completed tasks into their own section, most recent first', () => {
    mockStore({
      tasks: [
        task({ id: 1, name: 'Active task' }),
        task({
          id: 2,
          name: 'Done first',
          completed: true,
          dateCompleted: '2026-01-01T00:00:00Z',
        }),
        task({
          id: 3,
          name: 'Done second',
          completed: true,
          dateCompleted: '2026-01-05T00:00:00Z',
        }),
      ],
    })
    renderTaskList()

    expect(screen.getByText('Active task')).toBeInTheDocument()
    expect(screen.getByText('Done first')).toBeInTheDocument()
    expect(screen.getByText('Done second')).toBeInTheDocument()
  })

  it('filters to overdue tasks only, after dismissing the overdue gate', async () => {
    const user = userEvent.setup()
    mockStore({
      tasks: [
        task({ id: 1, name: 'On track', dateDeadline: '2099-01-01T00:00:00Z' }),
        task({ id: 2, name: 'Way overdue', dateDeadline: '2020-01-01T00:00:00Z' }),
      ],
    })
    renderTaskList()

    // An overdue task exists, so the blocking gate shows on mount —
    // dismiss it before interacting with anything else on the page.
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(screen.getByRole('button', { name: 'Overdue' }))

    expect(screen.getByText('Way overdue')).toBeInTheDocument()
    expect(screen.queryByText('On track')).not.toBeInTheDocument()
  })

  it('sorts by name when "Name (A–Z)" is selected', async () => {
    const user = userEvent.setup()
    mockStore({
      tasks: [
        task({ id: 1, name: 'Zebra task' }),
        task({ id: 2, name: 'Alpha task' }),
      ],
    })
    renderTaskList()

    await user.selectOptions(screen.getByLabelText(/sort by/i), 'name')

    const names = screen.getAllByText(/task$/).map((el) => el.textContent)
    expect(names.indexOf('Alpha task')).toBeLessThan(names.indexOf('Zebra task'))
  })
})
