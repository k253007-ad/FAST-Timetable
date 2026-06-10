// Minimal inline icon set (Lucide-style strokes) — no icon library dependency.

const Icon = ({ size = 18, strokeWidth = 2, children, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    {children}
  </svg>
);

export const IconRefresh = (props) => (
  <Icon {...props}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Icon>
);

export const IconDownload = (props) => (
  <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Icon>
);

export const IconImage = (props) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </Icon>
);

export const IconSun = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Icon>
);

export const IconMoon = (props) => (
  <Icon {...props}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Icon>
);

export const IconSearch = (props) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Icon>
);

export const IconX = (props) => (
  <Icon {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Icon>
);

export const IconCheck = (props) => (
  <Icon {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);

export const IconAlert = (props) => (
  <Icon {...props}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </Icon>
);

export const IconCalendar = (props) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
);

export const IconChevronDown = (props) => (
  <Icon {...props}>
    <polyline points="6 9 12 15 18 9" />
  </Icon>
);

/** App brand mark — gradient tile with a calendar grid. */
export const BrandMark = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#6366f1" />
        <stop offset="1" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="15" fill="url(#brand-grad)" />
    <rect x="13" y="17" width="38" height="34" rx="6" fill="#fff" fillOpacity="0.96" />
    <rect x="20" y="10" width="5" height="11" rx="2.5" fill="#fff" fillOpacity="0.85" />
    <rect x="39" y="10" width="5" height="11" rx="2.5" fill="#fff" fillOpacity="0.85" />
    <rect x="13" y="17" width="38" height="9" rx="4.5" fill="#fff" fillOpacity="0.3" />
    <circle cx="23.5" cy="35" r="3.2" fill="#6366f1" />
    <circle cx="32" cy="35" r="3.2" fill="#8b5cf6" fillOpacity="0.55" />
    <circle cx="40.5" cy="35" r="3.2" fill="#8b5cf6" fillOpacity="0.55" />
    <circle cx="23.5" cy="43.5" r="3.2" fill="#8b5cf6" fillOpacity="0.55" />
    <circle cx="32" cy="43.5" r="3.2" fill="#6366f1" />
    <circle cx="40.5" cy="43.5" r="3.2" fill="#8b5cf6" fillOpacity="0.55" />
  </svg>
);
