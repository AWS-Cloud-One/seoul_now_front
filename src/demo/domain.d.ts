import type { Conditions, Place, Trip, Result, Response, Parsed } from './types'
export const PURPOSES: string[]
export const PURPOSE_ICONS: string[]
export const DEPARTURES: Record<string, { lat: number; lon: number; region: string }>
export const EMPTY_CONDITIONS: Conditions
export const PLACES: Place[]
export function parseChat(text: string): Parsed
export function mockETA(place: Place, conditions: Conditions): number
export function mockDistanceKm(
  place: { lat: number; lon: number },
  origin: { lat: number; lon: number },
): number
export function newState(): Trip
export function normalizeTrip(trip: Trip): Trip
export function validSavedTrip(value: unknown): value is Trip
export function dateLabel(value: string | null | undefined): string
export function timeLabel(value: string | null | undefined): string
export function conditionText(value: Conditions): string
export function groupTitle(value: Result): string
export function patchConditions(base: Conditions, patch: Partial<Conditions>): Conditions
export function validateConditions(value: Conditions): string
export function conditionsEqual(a: Conditions, b: Conditions): boolean
export function conditionChanges(a: Conditions, b: Conditions): string[]
export function placeById(id: string | null | undefined, result?: Result | null): Place | undefined
export const MockService: {
  recommend(request: {
    conditions: Conditions
    excluded: string[]
    scenario: string
    onProgress?: (event: { stage: string; detail: string }) => boolean
    isActive?: () => boolean
  }): Promise<Response>
  route(request: { general: Result }): Promise<Response>
  traffic(id: string, conditions: Conditions): Promise<{ id: string; eta: number; time: string }>
  locate(mode: string): Promise<{ departure?: string; error?: string }>
  interpret(text: string): Promise<Parsed>
}
