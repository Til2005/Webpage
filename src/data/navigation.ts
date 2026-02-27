import { categories } from "./categories";

export interface NavItem {
  label: string;
  labelEn: string;
  href: string;
  icon: string;
  type: 'link' | 'launcher';
}

export const navItems: NavItem[] = categories.map((cat) => ({
  label: cat.name,
  labelEn: cat.nameEn,
  href: cat.href ?? `/${cat.slug}`,
  icon: cat.icon,
  type: cat.type || 'link',
}));
