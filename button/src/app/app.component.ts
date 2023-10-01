import { Component, Input, Output, EventEmitter } from '@angular/core';
import { ButtonTypes, EmitterType } from './types/button.type';

@Component({
  standalone: true,
  selector: 'sorye-ui-button',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = 'ui-button';

  @Input()
  public text!: string;
  @Input()
  public buttonType: ButtonTypes = 'SUBMIT';
  @Input()
  public disabled = false;

  @Output()
  public handleClick: EventEmitter<EmitterType> = new EventEmitter();
}
