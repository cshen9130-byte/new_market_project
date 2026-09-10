"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import type { SelectableProduct } from "@/lib/ma-product-selection-actions"

function productKey(product: Pick<SelectableProduct, "id" | "beian_hao">): string {
  return (product.beian_hao?.trim() || product.id).toUpperCase()
}

let items: SelectableProduct[] = []
const listeners = new Set<() => void>()
const clearListeners = new Set<() => void>()
const removeListeners = new Set<(id: string) => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeProductSelection(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getProductSelectionSnapshot(): SelectableProduct[] {
  return items
}

export function useProductSelectionBag(): SelectableProduct[] {
  return useSyncExternalStore(subscribeProductSelection, getProductSelectionSnapshot, () => items)
}

export function upsertProductSelection(products: SelectableProduct[]) {
  if (products.length === 0) return
  const map = new Map(items.map((product) => [productKey(product), product]))
  let changed = false
  for (const product of products) {
    const key = productKey(product)
    if (!key) continue
    const next: SelectableProduct = {
      ...product,
      id: key,
    }
    const prev = map.get(key)
    if (
      !prev
      || prev.product_name !== next.product_name
      || prev.beian_hao !== next.beian_hao
      || prev.latest_nav_date !== next.latest_nav_date
    ) {
      map.set(key, next)
      changed = true
    }
  }
  if (!changed) return
  items = [...map.values()]
  emit()
}

export function removeProductSelection(id: string) {
  const key = id.trim().toUpperCase()
  if (!key) return
  const next = items.filter((product) => productKey(product) !== key && product.id.toUpperCase() !== key)
  if (next.length === items.length) {
    for (const listener of removeListeners) listener(id)
    return
  }
  items = next
  emit()
  for (const listener of removeListeners) listener(id)
}

export function clearProductSelection() {
  const hadItems = items.length > 0
  if (hadItems) {
    items = []
    emit()
  }
  for (const listener of clearListeners) listener()
}

export function subscribeProductSelectionCleared(listener: () => void) {
  clearListeners.add(listener)
  return () => {
    clearListeners.delete(listener)
  }
}

export function subscribeProductSelectionRemoved(listener: (id: string) => void) {
  removeListeners.add(listener)
  return () => {
    removeListeners.delete(listener)
  }
}

export function toggleIdsInSelection(selected: Set<string>, ids: string[]): Set<string> {
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
  const next = new Set(selected)
  if (allOn) {
    for (const id of ids) next.delete(id)
  } else {
    for (const id of ids) next.add(id)
  }
  return next
}

export function pageSelectionChecked(selected: Set<string>, ids: string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.has(id))
}

let dockOwnerIds: symbol[] = []
const dockOwnerListeners = new Set<() => void>()

function emitDockOwner() {
  for (const listener of dockOwnerListeners) listener()
}

export function subscribeProductSelectionDockOwner(listener: () => void) {
  dockOwnerListeners.add(listener)
  return () => {
    dockOwnerListeners.delete(listener)
  }
}

export function useProductSelectionDockOwner(): boolean {
  const idRef = useRef<symbol>(Symbol())
  const id = idRef.current
  useEffect(() => {
    dockOwnerIds.push(id)
    emitDockOwner()
    return () => {
      dockOwnerIds = dockOwnerIds.filter((ownerId) => ownerId !== id)
      emitDockOwner()
    }
  }, [id])
  return useSyncExternalStore(
    subscribeProductSelectionDockOwner,
    () => dockOwnerIds[0] === id,
    () => false,
  )
}
