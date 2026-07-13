import '../src/register';

document.querySelector('sorye-input')?.addEventListener('sorye-input', (e) => {
  const detail = (e as CustomEvent<{ value: string }>).detail;
  console.debug('[sdk demo] input:', detail.value);
});
