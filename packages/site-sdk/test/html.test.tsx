/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag Fragment */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fragment, h, Html, renderToString, type Child } from '../src/html';

test('text and attributes are escaped; void elements close themselves', () => {
  const evil = '"><script>alert(1)</script>&';
  assert.equal(
    renderToString(<p title={evil} className="x">{evil}<br />{3}{false}{null}</p>),
    '<p title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;" class="x">"&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;<br>3</p>',
  );
});

test('boolean attributes, renamed attributes, fragments and components', () => {
  const Item = ({ label, children }: { label: string; children?: Child }) => <li data-label={label}>{children}</li>;
  const html = renderToString(
    <>
      <input required disabled={false} tabIndex={-1} autoComplete="off" />
      <button type="button" popoverTarget="p1" popoverTargetAction="hide">x</button>
      <ul>{['a', 'b'].map((v) => <Item key={v} label={v}>{v}</Item>)}</ul>
    </>,
  );
  assert.equal(html, '<input required tabindex="-1" autocomplete="off"><button type="button" popovertarget="p1" popovertargetaction="hide">x</button><ul><li data-label="a">a</li><li data-label="b">b</li></ul>');
});

test('event handlers, inline styles and raw HTML are refused', () => {
  assert.throws(() => <a onClick="alert(1)">x</a>, /not allowed/);
  assert.throws(() => <p style="color:red">x</p>, /not allowed/);
  assert.throws(() => <div dangerouslySetInnerHTML={{ __html: '<b>' }} />, /not allowed/);
  assert.throws(() => h('scr ipt', null), /Invalid element type/);
  assert.throws(() => new Html('<b>', Symbol('html')), /renderer only/);
});
