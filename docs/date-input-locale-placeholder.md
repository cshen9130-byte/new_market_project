# Native `<input type="date">` shows `yyyy/mm/日` (and similar)

## Symptom

Empty date fields display a broken / mixed placeholder such as:

- `yyyy/mm/日`
- `yyyy/mm/dd` mixed with Chinese glyphs
- other OS/browser-locale formats that do not match our UI copy (`请选择日期`)

This has been seen on **zh-CN Windows + Chromium** across many pages (指令、运维、尽调、筛选栏, etc.).

## Root cause

1. HTML `<input type="date">` **does not honor** the `placeholder` attribute in Chromium.
2. When the value is empty, the browser paints its own **locale-dependent format hint** inside the control (from OS / browser language settings).
3. On some Chinese Windows + Chrome combinations, that hint renders as the mixed string **`yyyy/mm/日`** (English tokens + Chinese day unit). We cannot change that string via CSS/`placeholder` alone.
4. The **wire value** is still always `YYYY-MM-DD` (`input.value`). Only the empty-state display text is wrong.

This is a browser/platform limitation, not bad form data.

## Required fix (project standard)

**Never show the native empty-state date format text.** Overlay our own label and keep the native picker for interaction.

Use the shared component:

```tsx
import { DateInput } from "@/components/ui/date-input"

<DateInput
  value={applyDate}
  onChange={setApplyDate}
  placeholder="请选择日期"
/>
```

### What the component does

1. Keep `type="date"` so `value` / `onChange` stay ISO `YYYY-MM-DD`.
2. Make Chromium’s internal datetime-edit text transparent (including empty hint).
3. Overlay our own text: placeholder when empty, formatted value when set.
4. Optionally open the native picker via `showPicker()` and show a calendar icon.

### Minimal pattern (if you cannot import the shared component yet)

```tsx
<div className="relative">
  <input
    type="date"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    className={[
      "w-full ... text-transparent caret-transparent",
      "[&::-webkit-datetime-edit]:text-transparent",
      "[&::-webkit-datetime-edit-fields-wrapper]:text-transparent",
      "[&::-webkit-datetime-edit-text]:text-transparent",
      "[&::-webkit-datetime-edit-year-field]:text-transparent",
      "[&::-webkit-datetime-edit-month-field]:text-transparent",
      "[&::-webkit-datetime-edit-day-field]:text-transparent",
      "[&::-webkit-calendar-picker-indicator]:opacity-0",
    ].join(" ")}
  />
  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
    {value || "请选择日期"}
  </span>
</div>
```

Hiding with only `text-transparent` on the `<input>` is **not enough** in Chromium — the `::-webkit-datetime-edit*` pseudo-elements must also be transparent.

## Anti-patterns (do not do)

```tsx
// ❌ Native empty hint still shows yyyy/mm/日 — placeholder is ignored
<input type="date" placeholder="请选择日期" />

// ❌ Same bug — CalendarDays does not hide the native format text
<div className="relative">
  <CalendarDays className="absolute left-3 ..." />
  <input type="date" className="pl-9" />
</div>

// ❌ Do not invent a custom value format; keep YYYY-MM-DD for APIs / state
```

## When touching date UI

1. **Read this file first.**
2. Prefer `@/components/ui/date-input`.
3. Keep state as `YYYY-MM-DD` strings.
4. Use Chinese UI copy for empty state (`请选择日期` / field-specific text), not `yyyy/mm/dd`.
5. If you find a raw `type="date"` without the overlay, migrate it to `DateInput`.

## Existing in-repo references

| Location | Notes |
| --- | --- |
| `components/ui/date-input.tsx` | **Canonical shared fix** |
| `InstructionsListView` `FilterDateInput` | Earlier local fix (same idea) |
| `page.tsx` `OpsDateInput` | Partial fix (transparent when empty only) |

## Related Cursor rule

`.cursor/rules/date-input.mdc` — agents must follow this doc when adding or editing date fields.
