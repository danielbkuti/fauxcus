import { describe, it, expect } from 'vitest'
import {
  addMonths,
  computeGoalProgress,
  daysUntil,
  describeTimeLeft,
  formatTargetDate,
  parseTargetDate,
  sortActiveGoals,
  toDateInputValue,
} from './goals'

// Local noon, so no timezone/DST edge can move it across a day boundary.
const NOW = new Date(2026, 10, 18, 12, 0, 0)

describe('parseTargetDate / toDateInputValue', () => {
  it('parses a plain date as local midnight, not UTC', () => {
    const d = parseTargetDate('2026-03-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 1])
  })

  it('round-trips through toDateInputValue', () => {
    expect(toDateInputValue(parseTargetDate('2026-03-01'))).toBe('2026-03-01')
  })

  it('returns null for missing or malformed values', () => {
    expect(parseTargetDate(null)).toBeNull()
    expect(parseTargetDate('')).toBeNull()
    expect(parseTargetDate('03/01/2026')).toBeNull()
  })
})

describe('formatTargetDate', () => {
  it('formats from the local date (no off-by-one from UTC parsing)', () => {
    expect(formatTargetDate('2026-03-01')).toMatch(/1/)
    expect(formatTargetDate('2026-03-01')).toMatch(/2026/)
    expect(formatTargetDate(null)).toBeNull()
  })
})

describe('daysUntil / describeTimeLeft', () => {
  it('counts whole calendar days', () => {
    expect(daysUntil('2026-11-18', NOW)).toBe(0)
    expect(daysUntil('2026-11-19', NOW)).toBe(1)
    expect(daysUntil('2026-11-17', NOW)).toBe(-1)
    expect(daysUntil('2027-01-17', NOW)).toBe(60)
  })

  it('describes the time left the way people say it', () => {
    expect(describeTimeLeft('2026-11-18', NOW)).toBe('Today')
    expect(describeTimeLeft('2026-11-19', NOW)).toBe('Tomorrow')
    expect(describeTimeLeft('2026-11-17', NOW)).toBe('Yesterday')
    expect(describeTimeLeft('2026-11-30', NOW)).toBe('in 12 days')
    expect(describeTimeLeft('2026-11-10', NOW)).toBe('8 days ago')
    expect(describeTimeLeft('2027-01-17', NOW)).toBe('in 2 months')
    expect(describeTimeLeft('2027-11-18', NOW)).toBe('in 1 year')
    expect(describeTimeLeft(null, NOW)).toBeNull()
  })
})

describe('addMonths', () => {
  it('adds calendar months', () => {
    expect(toDateInputValue(addMonths(3, NOW))).toBe('2027-02-18')
    expect(toDateInputValue(addMonths(12, NOW))).toBe('2027-11-18')
  })

  it('clamps to the last day of a shorter month', () => {
    const jan31 = new Date(2027, 0, 31, 12)
    expect(toDateInputValue(addMonths(1, jan31))).toBe('2027-02-28')
  })
})

describe('computeGoalProgress', () => {
  it('is the percent of tasks completed', () => {
    const tasks = [{ completed: true }, { completed: true }, { completed: false }, { completed: false }]
    expect(computeGoalProgress(tasks)).toEqual({ total: 4, done: 2, percent: 50 })
  })

  it('is 0 — not NaN — for a goal with no tasks', () => {
    expect(computeGoalProgress([])).toEqual({ total: 0, done: 0, percent: 0 })
  })
})

describe('sortActiveGoals', () => {
  it('orders soonest target first, undated goals last (newest first)', () => {
    const goals = [
      { id: 1, targetDate: null, dateCreated: '2026-01-01T00:00:00Z' },
      { id: 2, targetDate: '2026-12-01', dateCreated: '2026-01-01T00:00:00Z' },
      { id: 3, targetDate: null, dateCreated: '2026-06-01T00:00:00Z' },
      { id: 4, targetDate: '2026-11-20', dateCreated: '2026-01-01T00:00:00Z' },
    ]
    expect(sortActiveGoals(goals).map((g) => g.id)).toEqual([4, 2, 3, 1])
  })

  it('does not mutate its input', () => {
    const goals = [
      { id: 1, targetDate: '2026-12-01' },
      { id: 2, targetDate: '2026-11-01' },
    ]
    sortActiveGoals(goals)
    expect(goals.map((g) => g.id)).toEqual([1, 2])
  })
})
