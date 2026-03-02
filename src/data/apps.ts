export interface App {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  icon: string;
  href: string;
  comingSoon?: boolean;
}

export const apps: App[] = [
  {
    id: 'txfe',
    name: 'TXFE',
    nameEn: 'TXFE',
    description: 'Foto Editor',
    descriptionEn: 'Photo Editor',
    icon: '/icons/apps/txfe.svg',
    href: '/app/txfe',
  },
  {
    id: 'txn',
    name: 'TXN',
    nameEn: 'TXN',
    description: 'Notes',
    descriptionEn: 'Notes',
    icon: '/icons/apps/txn.svg',
    href: '/app/txn',
  },
  {
    id: 'txc',
    name: 'TXC',
    nameEn: 'TXC',
    description: 'Cloud',
    descriptionEn: 'Cloud',
    icon: '/icons/apps/txc.svg',
    href: '/app/txc',
  },
  {
    id: 'txme',
    name: 'TXME',
    nameEn: 'TXME',
    description: 'Über mich',
    descriptionEn: 'About me',
    icon: '/icons/apps/txme.svg',
    href: '/app/txme',
  },
  {
    id: 'txcv',
    name: 'TXCV',
    nameEn: 'TXCV',
    description: 'Konverter',
    descriptionEn: 'Converter',
    icon: '/icons/apps/txcv.svg',
    href: '/app/txcv',
  },
];
