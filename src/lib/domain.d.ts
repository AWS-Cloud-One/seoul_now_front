import type { Conditions, Place, Trip, Result } from '../types/trip'
export const PURPOSES: string[]
export const EMPTY_CONDITIONS: Conditions
export function newState(): Trip
export function normalizeTrip(trip: Trip): Trip
export function validSavedTrip(value: unknown): value is Trip
export function dateLabel(value: string | null | undefined): string
export function conditionText(value: Conditions): string
export function patchConditions(base: Conditions, patch: Partial<Conditions>): Conditions
export function validateConditions(value: Conditions): string
export function conditionsEqual(a: Conditions, b: Conditions): boolean
export function conditionChanges(a: Conditions, b: Conditions): string[]
export function placeById(id: string | null | undefined, result?: Result | null): Place | undefined
