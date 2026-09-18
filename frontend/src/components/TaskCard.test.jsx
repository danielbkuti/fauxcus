import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TaskCard } from './TaskCard'

function baseTask(overrides = {}) {
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

function renderTaskCard({ task: taskOverrides, ...handlerOverrides } = {}) {
  const handlers = {
    onToggleComplete: vi.fn(),
    onSetDeadline: vi.fn(),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onAddSubtask: vi.fn(),
    onToggleSubtask: vi.fn(),
    onSetSubtaskDeadline: vi.fn(),
    onDeleteSubtask: vi.fn(),
    ...handlerOverrides,
  }
  render(
    <MemoryRouter>
      <TaskCard task={baseTask(taskOverrides)} {...handlers} />
    </MemoryRouter>
  )
  return handlers
}

describe('TaskCard', () => {
  it('renders the task name and a "Pending" toggle for an incomplete task', () => {
    renderTaskCard()

    expect(screen.getByText('Write tests')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pending' })).toBeInTheDocument()
  })

  it('calls onToggleComplete(task, true) when the Pending button is clicked', async () => {
    const user = userEvent.setup()
    const handlers = renderTaskCard()

    await user.click(screen.getByRole('button', { name: 'Pending' }))

    expect(handlers.onToggleComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Write tests' }),
      true
    )
  })

  it('renders a "Completed" toggle for a completed task and calls onToggleComplete(task, false)', async () => {
    const user = userEvent.setup()
    const handlers = renderTaskCard({
      task: { completed: true, dateCompleted: '2026-01-02T00:00:00Z' },
    })

    await user.click(screen.getByRole('button', { name: 'Completed' }))

    expect(handlers.onToggleComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), false)
  })

  it('blocks completion while any subtask is still incomplete', () => {
    renderTaskCard({
      task: { subtasks: [{ id: 10, name: 'Sub one', completed: false, dateDeadline: null }] },
    })

    expect(screen.getByRole('button', { name: 'Pending' })).toBeDisabled()
  })

  it('deletes the task after the two-step confirm', async () => {
    const user = userEvent.setup()
    const handlers = renderTaskCard()

    await user.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(screen.getByText(/are you sure you want to delete this task/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(handlers.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('cancels the delete confirm without calling onDelete', async () => {
    const user = userEvent.setup()
    const handlers = renderTaskCard()

    await user.click(screen.getByRole('button', { name: 'Delete task' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('does not offer a delete button for a completed task', () => {
    renderTaskCard({ task: { completed: true } })

    expect(screen.queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument()
  })
})
