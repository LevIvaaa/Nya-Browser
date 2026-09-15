import { JsonStore, track } from './store'
import type { Note, Todo } from '../shared/types'

/**
 * The things somebody puts on their own start page.
 *
 * Two lists — sticky notes and a to-do — kept per profile, on this machine,
 * in a plain file. No account, no sync, no server: a note somebody scribbles
 * on their browser's front page is the least appropriate thing in the world to
 * send anywhere.
 *
 * Both are deliberately small. A start page is a place to glance at, not a
 * place to write a novel in, and a widget that can hold ten thousand items is
 * a widget that scrolls forever and helps nobody.
 */

interface DeskData {
  notes: Note[]
  todos: Todo[]
}

/** More than this on a start page is a different application. */
const MAX_NOTES = 30
const MAX_TODOS = 100
const NOTE_MAX = 4000
const TODO_MAX = 300

const DESK_VERSION = 1

/** One of the colours a note can be, and nothing else. */
const NOTE_COLOURS = ['yellow', 'pink', 'blue', 'green', 'plain'] as const

const id = (value: unknown) => String(value ?? '').replace(/[^\w-]/g, '').slice(0, 24)

function sanitize(data: Partial<DeskData>): DeskData {
  const notes: Note[] = []
  if (Array.isArray(data.notes)) {
    for (const row of data.notes.slice(0, MAX_NOTES)) {
      const one = (row ?? {}) as Partial<Note>
      const key = id(one.id)
      if (!key) continue
      notes.push({
        id: key,
        text: String(one.text ?? '').slice(0, NOTE_MAX),
        colour: NOTE_COLOURS.includes(one.colour as (typeof NOTE_COLOURS)[number])
          ? (one.colour as Note['colour'])
          : 'yellow',
        at: Number.isFinite(one.at) ? Number(one.at) : Date.now()
      })
    }
  }

  const todos: Todo[] = []
  if (Array.isArray(data.todos)) {
    for (const row of data.todos.slice(0, MAX_TODOS)) {
      const one = (row ?? {}) as Partial<Todo>
      const key = id(one.id)
      // Trimmed before it is judged: three spaces is somebody who pressed
      // Enter by accident, not a thing to do.
      const text = String(one.text ?? '').trim().slice(0, TODO_MAX)
      if (!key || !text) continue
      todos.push({
        id: key,
        text,
        done: one.done === true,
        at: Number.isFinite(one.at) ? Number(one.at) : Date.now()
      })
    }
  }

  return { notes, todos }
}

class Desk {
  private store = track(
    new JsonStore<DeskData>(
      'desk.json',
      () => ({ notes: [], todos: [] }),
      DESK_VERSION,
      (data) => data as DeskData,
      (data) => sanitize((data ?? {}) as Partial<DeskData>)
    )
  )

  load(dir: string) {
    this.store.open(dir)
  }

  all(): DeskData {
    const { notes, todos } = this.store.get()
    return { notes, todos }
  }

  /** Writes one note, or removes it when the text is gone. */
  setNote(note: Note): DeskData {
    const data = this.store.get()
    const notes = data.notes.filter((one) => one.id !== note.id)
    if (note.text.trim()) {
      notes.unshift(sanitize({ notes: [note], todos: [] }).notes[0])
    }
    this.store.set({ ...data, notes: notes.slice(0, MAX_NOTES) })
    return this.all()
  }

  removeNote(noteId: string): DeskData {
    const data = this.store.get()
    this.store.set({ ...data, notes: data.notes.filter((one) => one.id !== noteId) })
    return this.all()
  }

  /**
   * Writes one item of the list.
   *
   * Done items stay where they are rather than sinking to the bottom: a list
   * that rearranges itself under the hand ticking it off is a list that gets
   * the wrong thing ticked.
   */
  setTodo(todo: Todo): DeskData {
    const data = this.store.get()
    const clean = sanitize({ notes: [], todos: [todo] }).todos[0]
    if (!clean) return this.all()
    const at = data.todos.findIndex((one) => one.id === clean.id)
    const todos = [...data.todos]
    if (at === -1) todos.push(clean)
    else todos[at] = clean
    this.store.set({ ...data, todos: todos.slice(0, MAX_TODOS) })
    return this.all()
  }

  removeTodo(todoId: string): DeskData {
    const data = this.store.get()
    this.store.set({ ...data, todos: data.todos.filter((one) => one.id !== todoId) })
    return this.all()
  }

  /** Everything ticked off, gone in one press. */
  clearDone(): DeskData {
    const data = this.store.get()
    this.store.set({ ...data, todos: data.todos.filter((one) => !one.done) })
    return this.all()
  }

  flush() {
    this.store.flush()
  }
}

export const desk = new Desk()
