export interface Retailer {
  name: string
  city: string
  country: string
  beans: string[]
  since: number
}

export const RETAILERS: Retailer[] = [
  {
    name: 'The Copper Kettle',
    city: 'Montréal',
    country: 'Canada',
    beans: ['Huila', 'Sidamo'],
    since: 2019,
  },
  {
    name: 'Grind & Gather',
    city: 'Portland',
    country: 'United States',
    beans: ['Huila'],
    since: 2020,
  },
  {
    name: 'Café Lumière',
    city: 'Lyon',
    country: 'France',
    beans: ['Sidamo', 'Tarrazú', 'Huila'],
    since: 2021,
  },
  {
    name: 'Blue Hour Coffee',
    city: 'Melbourne',
    country: 'Australia',
    beans: ['Tarrazú'],
    since: 2021,
  },
  {
    name: 'Kaffeehaus Nord',
    city: 'Hamburg',
    country: 'Germany',
    beans: ['Sidamo', 'Huila'],
    since: 2022,
  },
  {
    name: 'Morning Ritual',
    city: 'Toronto',
    country: 'Canada',
    beans: ['Tarrazú', 'Sidamo'],
    since: 2023,
  },
  {
    name: 'Slow Pour Bar',
    city: 'Kyoto',
    country: 'Japan',
    beans: ['Huila', 'Tarrazú'],
    since: 2024,
  },
]

export const OPENING_SOON = ['Lisbon, Portugal', 'Oslo, Norway', 'Austin, United States']

export interface Origin {
  name: string
  region: string
  notes: string
}

export const ORIGINS: Origin[] = [
  { name: 'Huila', region: 'Colombia', notes: 'Red apple, panela, a long cocoa finish.' },
  { name: 'Sidamo', region: 'Ethiopia', notes: 'Bergamot, peach and black tea.' },
  { name: 'Tarrazú', region: 'Costa Rica', notes: 'Honey, orange zest, a clean body.' },
]
