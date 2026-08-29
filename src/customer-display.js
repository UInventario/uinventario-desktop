const message = document.querySelector('#message');
const lines = document.querySelector('#lines');
const total = document.querySelector('#total');

window.uinventarioCustomerDisplay?.onUpdate((state) => {
  message.textContent = state.message;
  total.textContent = `${state.currency} ${state.total}`.trim();
  lines.replaceChildren(
    ...state.lines.map((line) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      const amount = document.createElement('strong');
      name.textContent = `${line.quantity} × ${line.name}`;
      amount.textContent = `${state.currency} ${line.total}`.trim();
      item.append(name, amount);
      return item;
    }),
  );
});
