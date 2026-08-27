export interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "搜索项目…",
  width = "w-60",
}: SearchInputProps) {
  return (
    <div className={`relative ${width}`}>
      <span
        className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
        aria-hidden="true"
      >
        search
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-container border border-outline-variant rounded pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
      />
    </div>
  );
}