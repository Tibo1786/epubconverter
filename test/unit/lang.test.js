import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage } from '../../src/core/lang.js';

const samples = {
  es: 'Caminamos por calles estrechas que subían hacia la parte vieja del pueblo. Remei andaba deprisa, con pasos cortos y precisos, como si contara cada adoquín.',
  ca: 'Feia tres dies que bufava la tramuntana i el poble semblava haver-se encongit sobre si mateix. Les barques estaven amarrades amb dobles caps.',
  en: 'Nobody in Pembury ever asked why the weather office stood at the end of the pier. It had always been there, a white wooden hut with a brass barometer.',
  fr: 'Le premier matin, la pluie tombait si doucement sur Lyon qu’on aurait dit une hésitation. Madeleine ouvrit les volets de l’appartement.',
};

for (const [lang, text] of Object.entries(samples)) {
  test(`detects ${lang}`, () => assert.equal(detectLanguage(text).lang, lang));
}

test('Catalan vs Spanish on short dialogue', () => {
  assert.equal(detectLanguage('—Avui no hi ha col·lecció —va dir, assenyalant el mar embravit.').lang, 'ca');
  assert.equal(detectLanguage('—¿A las tres y diecisiete? —repitió, sin levantar la vista.').lang, 'es');
});
