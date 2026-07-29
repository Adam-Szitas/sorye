import { createComponent, type EventName } from '@lit/react';
import React from 'react';
import { SoryeBadge } from '../components/badge';
import { SoryeButton } from '../components/button';
import { SoryeCard } from '../components/card';
import { SoryeDivider } from '../components/divider';
import { SoryeIcon } from '../components/icon';
import { SoryeInput } from '../components/input';
import { SoryeSelect } from '../components/select';
import { SoryeSpinner } from '../components/spinner';

type InputDetail = { value: string; name: string };

export const Badge = createComponent({
  tagName: 'sorye-badge',
  elementClass: SoryeBadge,
  react: React,
});

export const Button = createComponent({
  tagName: 'sorye-button',
  elementClass: SoryeButton,
  react: React,
});

export const Card = createComponent({
  tagName: 'sorye-card',
  elementClass: SoryeCard,
  react: React,
});

export const Divider = createComponent({
  tagName: 'sorye-divider',
  elementClass: SoryeDivider,
  react: React,
});

export const Icon = createComponent({
  tagName: 'sorye-icon',
  elementClass: SoryeIcon,
  react: React,
});

export const Input = createComponent({
  tagName: 'sorye-input',
  elementClass: SoryeInput,
  react: React,
  events: {
    onSoryeInput: 'sorye-input' as EventName<CustomEvent<InputDetail>>,
    onSoryeChange: 'sorye-change' as EventName<CustomEvent<InputDetail>>,
  },
});

export const Select = createComponent({
  tagName: 'sorye-select',
  elementClass: SoryeSelect,
  react: React,
  events: {
    onSoryeChange: 'sorye-change' as EventName<CustomEvent<InputDetail>>,
  },
});

export type { SelectOption } from '../components/select';

export const Spinner = createComponent({
  tagName: 'sorye-spinner',
  elementClass: SoryeSpinner,
  react: React,
});
