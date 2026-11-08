/** An icon from the sprite in index.html. */
export function Icon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return <svg className={className} style={style} aria-hidden="true"><use href={'#' + name} /></svg>;
}

/** A toolbar button with just an icon (its title is the tooltip and the accessible name). */
export function IconButton({ icon, label, title, className, ...rest }: {
  icon: string; label: string; title?: string; className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & Record<`data-${string}`, string>) {
  return (
    <button type="button" className={'icon' + (className ? ' ' + className : '')} title={title ?? label} aria-label={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}
