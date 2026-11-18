<script lang="ts" module>
  const PATHS = {
    left: 'M15 6l-6 6 6 6',
    right: 'M9 6l6 6-6 6',
    back: 'M5 12h14M5 12l6-6M5 12l6 6',
    plus: 'M12 5v14M5 12h14',
    list: 'M9 6h11M9 12h11M9 18h11M5 6h.01M5 12h.01M5 18h.01',
    settings: 'M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 002.6 1.1c1.5-.9 3.3.8 2.4 2.4a1.7 1.7 0 001 2.5c1.9.4 1.9 3 0 3.4a1.7 1.7 0 00-1 2.6c.9 1.5-.9 3.3-2.4 2.4a1.7 1.7 0 00-2.6 1c-.4 1.9-3 1.9-3.4 0a1.7 1.7 0 00-2.6-1c-1.5.9-3.3-.9-2.4-2.4a1.7 1.7 0 00-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 001-2.5c-.9-1.6.9-3.3 2.4-2.4a1.7 1.7 0 002.6-1.1zM12 9a3 3 0 100 6 3 3 0 000-6z',
    check: 'M5 12l5 5 9-10',
    play: 'M8 5v14l11-7z',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    up: 'M6 15l6-6 6 6',
    down: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
    clock: 'M12 7v5l3 3M12 3a9 9 0 100 18 9 9 0 000-18z',
    repeat: 'M4 12V9a3 3 0 013-3h13M17 3l3 3-3 3M20 12v3a3 3 0 01-3 3H4M7 21l-3-3 3-3',
    x: 'M6 6l12 12M18 6L6 18',
    face: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 10h.01M15 10h.01M9 15c1.5 1 4.5 1 6 0',
    share: 'M12 15V4M8 8l4-4 4 4M5 13v6h14v-6',
    // Flip a table: a table with a header row and column, and a two-way curved arrow round its top-left corner.
    transpose: 'M9 9h12v12H9zM9 13h12M13 9v12M13 3.5A9.5 9.5 0 003.5 13M11 1.5l2 2-2 2M1.5 11l2 2 2-2',
    // Squeeze a list together: a line in the middle with arrows pressing in from above and below.
    collapse: 'M4 12h16M12 3v5M9 5l3 3 3-3M12 21v-5M9 19l3-3 3 3',
    link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    // A list with a curved arrow on its left: from the first item round to the last.
    'first-to-end': 'M13 6h8M13 12h8M13 18h8M9 6C3 6 3 14 9 18M8.2 14.1L9 18l-3.9.8',
    // The same, from the last item round to the first.
    'last-to-start': 'M13 6h8M13 12h8M13 18h8M9 18C3 18 3 10 9 6M8.2 9.9L9 6l-3.9-.8',
    lines: 'M4 6h16M4 10h16M4 14h10M17 15v6M14 18h6',
    calendar: 'M5 6h14v14H5zM5 10h14M9 4v4M15 4v4',
    bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
    search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
    run: 'M13 4a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM6 20l3-6 3 2 1 4M9 14l1-4 4-1 2 3 3 1M10 10l-3 1-1 3',
    pause: 'M9 5v14M15 5v14',
    minus: 'M5 12h14',
    grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
    skip: 'M5 12h14M13 6l6 6-6 6',
    reset: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
    table: 'M4 5h16v14H4zM4 10h16M10 5v14',
    dumbbell: 'M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 22 }: { name: IconName; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[name]} />
</svg>
