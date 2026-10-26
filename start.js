import app from './server.js';

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`CodeEverything corriendo en http://localhost:${port}`);
});
