/**
 * Loop registry loader.
 * Reads ops/loops/registry.json relative to the project root.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { LoopEntry, LoopRegistry } from './types'

let _cached: LoopRegistry | null = null

export function loadRegistry(): LoopRegistry {
  if (_cached) return _cached

  const registryPath = path.resolve(process.cwd(), 'ops/loops/registry.json')
  const raw = fs.readFileSync(registryPath, 'utf-8')
  _cached = JSON.parse(raw) as LoopRegistry
  return _cached
}

export function getLoop(loopId: string): LoopEntry | null {
  const registry = loadRegistry()
  return registry.loops.find((l) => l.id === loopId) ?? null
}

export function listLoops(): LoopEntry[] {
  return loadRegistry().loops
}

export function getEnabledLoops(): LoopEntry[] {
  return loadRegistry().loops.filter((l) => l.enabled)
}
