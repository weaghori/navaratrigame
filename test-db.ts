fetch("https://navaratrigame.vercel.app/campaigns/navratri-2026")
  .then(r => r.text())
  .then(text => {
    console.log("Has navratri-2026:", text.includes("navratri-2026"));
    console.log("Has navratri-challenge:", text.includes("navratri-challenge"));
  })
  .catch(console.error);
