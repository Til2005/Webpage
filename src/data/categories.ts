export interface Category {
  name: string;
  slug: string;
  icon: string;
  nameEn: string;
  type?: 'link' | 'launcher';
  href?: string;
}

export const categories: Category[] = [
  {
    name: "Mixed Reality",
    slug: "mixed-reality",
    icon: "/icons/mixed-reality.svg",
    nameEn: "Mixed Reality",
  },
  {
    name: "Web Apps",
    slug: "web-apps",
    icon: "/icons/web-apps.svg",
    nameEn: "Web Apps",
    type: 'link',
    href: '/',
  },
  {
    name: "Projekt: AI Bytes",
    slug: "ai-bytes",
    icon: "/icons/ai-bytes.svg",
    nameEn: "Project: AI Bytes",
  },
];
