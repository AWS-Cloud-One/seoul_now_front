import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Icon from './Icon'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
export const PrimaryButton = ({ className = '', ...props }: ButtonProps) => (
  <button type="button" {...props} className={`sn-btn sn-btn-primary ${className}`} />
)
export const SecondaryButton = ({ className = '', ...props }: ButtonProps) => (
  <button type="button" {...props} className={`sn-btn sn-btn-secondary ${className}`} />
)
export const IconButton = ({
  label,
  icon,
  className = '',
  ...props
}: ButtonProps & { label: string; icon: string }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    {...props}
    className={`sn-icon-btn ${className}`}
  >
    <Icon name={icon} />
  </button>
)
export const FilterChip = ({
  pressed,
  className = '',
  ...props
}: ButtonProps & { pressed: boolean }) => (
  <button
    type="button"
    aria-pressed={pressed}
    {...props}
    className={`sn-chip ${pressed ? 'is-on' : ''} ${className}`}
  />
)
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info'
export const StatusBadge = ({
  tone = 'neutral',
  children,
}: {
  tone?: Tone
  children: ReactNode
}) => <span className={`sn-badge tone-${tone}`}>{children}</span>
export function PanelHeader({
  title,
  count,
  subtitle,
  actions,
  back,
}: {
  title: string
  count?: number
  subtitle?: ReactNode
  actions?: ReactNode
  back?: { label: string; onClick: () => void }
}) {
  return (
    <header className="sn-panel-header">
      {back && (
        <button type="button" className="sn-back" onClick={back.onClick}>
          <Icon name="chevronLeft" />
          {back.label}
        </button>
      )}
      <div className="sn-panel-title-row">
        <h2>
          {title}
          {count !== undefined && <span className="sn-count">{count}</span>}
        </h2>
        {actions}
      </div>
      {subtitle && <div className="sn-panel-sub">{subtitle}</div>}
    </header>
  )
}
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
}) {
  return (
    <label className="sn-search">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
export const EmptyState = ({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) => (
  <div className="sn-state">
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {action}
  </div>
)
export const ErrorState = ({
  title,
  children,
  onRetry,
}: {
  title: string
  children?: ReactNode
  onRetry?: () => void
}) => (
  <div className="sn-state is-error" role="alert">
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {onRetry && <SecondaryButton onClick={onRetry}>다시 시도</SecondaryButton>}
  </div>
)
export const LoadingSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="sn-skeletons" role="status" aria-label="불러오는 중">
    {Array.from({ length: rows }, (_, i) => (
      <div className="sn-skeleton" key={i} aria-hidden="true" />
    ))}
  </div>
)

/** Shows a few rows first and the rest on demand ("더 보기"). Remount with a new key to reset. */
export function PagedList<T>({
  items,
  initial = 5,
  step = 5,
  keep,
  render,
}: {
  items: T[]
  initial?: number
  step?: number
  /** Index that must stay visible (e.g. the row selected on the map). */
  keep?: number
  render: (item: T) => ReactNode
}) {
  const [limit, setLimit] = useState(initial)
  const shown = Math.min(items.length, Math.max(limit, (keep ?? -1) + 1))
  return (
    <>
      <ol className="sn-list">{items.slice(0, shown).map(render)}</ol>
      {shown < items.length && (
        <button type="button" className="sn-more-button" onClick={() => setLimit(shown + step)}>
          더 보기 ({shown}/{items.length})
        </button>
      )}
    </>
  )
}
