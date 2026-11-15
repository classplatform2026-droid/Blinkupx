export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="9" fill="#FFFFFF" />
      <path
        d="M9.5 11.5C9.5 10.3954 10.3954 9.5 11.5 9.5H20.5C21.6046 9.5 22.5 10.3954 22.5 11.5V17.5C22.5 18.6046 21.6046 19.5 20.5 19.5H15L11 23V19.5H11.5C10.3954 19.5 9.5 18.6046 9.5 17.5V11.5Z"
        fill="#181818"
      />
      <circle cx="13.5" cy="14.5" r="1.25" fill="#FFFFFF" />
      <circle cx="18.5" cy="14.5" r="1.25" fill="#FFFFFF" />
    </svg>
  );
}
