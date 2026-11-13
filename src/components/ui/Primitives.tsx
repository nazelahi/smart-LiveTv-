import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    const variants = {
      primary:
        'bg-sky-500 text-slate-950 font-semibold hover:bg-sky-400 active:bg-sky-600 disabled:opacity-50',
      secondary:
        'bg-[#171d28] text-slate-100 border border-slate-700/80 hover:bg-[#1e2634] disabled:opacity-50',
      ghost:
        'bg-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white disabled:opacity-40',
      danger:
        'bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-50',
    };

    const sizes = {
      sm: 'h-8 px-3 text-xs rounded-md',
      md: 'h-10 px-4 text-sm rounded-lg',
      lg: 'h-11 px-5 text-sm rounded-lg',
    };

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 cursor-pointer disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full h-10 px-3 rounded-lg bg-[#0d1117] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-colors',
      className
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'w-full h-10 px-3 rounded-lg bg-[#0d1117] border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-colors',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full p-3 rounded-lg bg-[#0d1117] border border-slate-800 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/50 transition-colors',
      className
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export function Surface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'bg-[#10151d] border border-slate-800/80 rounded-xl',
        className
      )}
    >
      {children}
    </div>
  );
}

export function StatusText({
  tone,
  label,
}: {
  tone: 'ok' | 'warn' | 'error' | 'muted';
  label: string;
}) {
  const toneClass = {
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    error: 'text-rose-400',
    muted: 'text-slate-400',
  }[tone];

  return (
    <span className={cn('text-xs font-medium whitespace-nowrap', toneClass)}>
      {label}
    </span>
  );
}

export function ModalDialog({
  open,
  title,
  description,
  onClose,
  children,
  maxWidth = 'max-w-xl',
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          'w-full bg-[#10151d] border border-slate-800 rounded-xl shadow-2xl overflow-hidden',
          maxWidth
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-800/80">
          <div>
            <h3 className="text-base font-semibold text-slate-100">{title}</h3>
            {description && (
              <p className="text-xs text-slate-400 mt-1">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-sm px-2 py-1 rounded cursor-pointer"
          >
            Close
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
