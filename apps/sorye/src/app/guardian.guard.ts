import { CanActivateFn } from '@angular/router';

export const guardianGuard: CanActivateFn = (route, state) => {
  return true;
};
