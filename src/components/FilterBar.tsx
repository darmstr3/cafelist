'use client'

import { SpotFilters, SpotType, NoiseLevel } from '@/types'
import { cn } from '@/lib/utils'
import { Clock, Wifi, Zap, Moon, Utensils, Bath, Monitor } from 'lucide-react'

interface FilterBarProps {
  filters: SpotFilters
  onChange: (filters: SpotFilters) => void
  cities: string[]
}

interface ToggleChipProps {
  active: boolean
  onClick: () => void
  icon?: React.ReactNode
  label: string
}

function ToggleChip({ active, onClick, icon, label }: ToggleChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap',
        active
          ? 'border-transparent'
          : 'border-transparent hover:border-opacity-50'
      )}
      style={
        active
          ? {
              backgroundColor: 'var(--accent)',
              color: 'white',
              borderColor: 'var(--accent)',
            }
          : {
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--border)',
            }
      }
    >
      {icon}
      {label}
    </button>
  )
}

export function FilterBar({ filters, onChange, cities }: FilterBarProps) {
  const set = (patch: Partial<SpotFilters>) => onChange({ ...filters, ...patch })

  return (
    <div className="w-full space-y-3">
      {/* City + Type selects */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filters.city}
          onChange={(e) => set({ city: e.target.value })}
          className="h-8 text-xs rounded-full pl-3 pr-7 border appearance-none cursor-pointer"
          style={{
            backgroundColor: filters.city ? 'var(--accent)' : 'var(--surface-2)',
            color: filters.city ? 'white' : 'var(--text-secondary)',
            borderColor: filters.city ? 'var(--accent)' : 'var(--border)',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          <option value="">All Cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={filters.type}
          onChange={(e) => set({ type: e.target.value as SpotType | '' })}
          className="h-8 text-xs rounded-full pl-3 pr-7 border appearance-none cursor-pointer"
          style={{
            backgroundColor: filters.type ? 'var(--accent)' : 'var(--surface-2)',
            color: filters.type ? 'white' : 'var(--text-secondary)',
            borderColor: filters.type ? 'var(--accent)' : 'var(--border)',
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'right 8px center',
          }}
        >
          <option value="">All Types</option>
          <option value="coffee_shop">Coffee Shop</option>
          <option value="hotel_lobby">Hotel Lobby</option>
          <option value="diner">Diner</option>
          <option value="bar">Bar</option>
          <option value="library">Library</option>
          <option value="coworking">Coworking</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Toggle chips */}
      <div className="flex flex-wrap gap-2">
        <ToggleChip
          active={filters.openNow}
          onClick={() => set({ openNow: !filters.openNow })}
          icon={<span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--yes)' }} />}
          label="Open Now"
        />
        <ToggleChip
          active={filters.openLate}
          onClick={() => set({ openLate: !filters.openLate })}
          icon={<Moon size={11} />}
          label="Open Late"
        />
        <ToggleChip
          active={filters.openAfter9pm}
          onClick={() => set({ openAfter9pm: !filters.openAfter9pm })}
          icon={<Clock size={11} />}
          label="After 9pm"
        />
        <ToggleChip
          active={filters.openAfterMidnight}
          onClick={() => set({ openAfterMidnight: !filters.openAfterMidnight })}
          icon={<Moon size={11} />}
          label="After Midnight"
        />
        <ToggleChip
          active={filters.hasWifi}
          onClick={() => set({ hasWifi: !filters.hasWifi })}
          icon={<Wifi size={11} />}
          label="Wi-Fi"
        />
        <ToggleChip
          active={filters.hasOutlets}
          onClick={() => set({ hasOutlets: !filters.hasOutlets })}
          icon={<Zap size={11} />}
          label="Outlets"
        />
        <ToggleChip
          active={filters.laptopFriendly}
          onClick={() => set({ laptopFriendly: !filters.laptopFriendly })}
          icon={<Monitor size={11} />}
          label="Laptop OK"
        />
        <ToggleChip
          active={filters.hasBathroom}
          onClick={() => set({ hasBathroom: !filters.hasBathroom })}
          icon={<Bath size={11} />}
          label="Bathroom"
        />
        <ToggleChip
          active={filters.hasFood}
          onClick={() => set({ hasFood: !filters.hasFood })}
          icon={<Utensils size={11} />}
          label="Food"
        />
      </div>

      {/* Noise level */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>Noise:</span>
        {(['silent', 'quiet', 'moderate', 'loud'] as NoiseLevel[]).map((level) => {
          const emoji = { silent: '🔇', quiet: '🔈', moderate: '🔉', loud: '🔊' }[level]
          return (
            <button
              key={level}
              onClick={() => set({ noiseLevel: filters.noiseLevel === level ? '' : level })}
              className="text-xs px-2 py-1 rounded-md border transition-all capitalize"
              style={
                filters.noiseLevel === level
                  ? { backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                  : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
              }
            >
              {emoji} {level}
            </button>
          )
        })}
      </div>

      {/* Reset */}
      {Object.values(filters).some((v) => v !== '' && v !== false && v !== 0) && (
        <button
          onClick={() =>
            onChange({
              search: '', city: '', neighborhood: '', openNow: false, openLate: false,
              openAfter9pm: false, openAfterMidnight: false, hasWifi: false,
              hasOutlets: false, laptopFriendly: false, hasBathroom: false,
              hasFood: false, hasDrinks: false, noiseLevel: '',
              minWorkScore: 0, minLateNightScore: 0, type: '',
            })
          }
          className="text-xs underline underline-offset-2 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}
