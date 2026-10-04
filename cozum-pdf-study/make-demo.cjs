const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('./vendor/pdf-lib.min.js');

(async () => {
  const pdf = await PDFDocument.create();
  pdf.setTitle('TYT Matematik — Deneme 07');
  pdf.setAuthor('Cozum | Ornek soru bankasi');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.12, 0.17, 0.27);
  const muted = rgb(0.43, 0.48, 0.56);
  const blue = rgb(0.28, 0.34, 0.84);
  const line = rgb(0.88, 0.90, 0.93);
  const pale = rgb(0.95, 0.96, 1);
  const pagesData = [
    [
      { n: 1, topic: 'Denklemler', lines: ['x^2 - 7x + 12 = 0 denkleminin kokleri a ve b\'dir.', 'Buna gore a + b kactir?'], options: ['A) 5', 'B) 6', 'C) 7', 'D) 8', 'E) 12'] },
      { n: 2, topic: 'Fonksiyonlar', lines: ['f(x) = 2x + 5 ve g(x) = x^2 - 1 olduguna gore', '(g o f)(1) degeri kactir?'], options: ['A) 30', 'B) 42', 'C) 48', 'D) 50', 'E) 54'] },
      { n: 3, topic: 'Ortalama', lines: ['Bes sayinin aritmetik ortalamasi 14\'tur. Diger dort sayi', '11, 13, 16 ve 18 ise eksik sayi kactir?'], options: ['A) 10', 'B) 12', 'C) 14', 'D) 16', 'E) 18'] },
    ],
    [
      { n: 4, topic: 'Denklemler', lines: ['3(2x - 1) = 5x + 8 denklemini saglayan x degeri', 'kactir?'], options: ['A) 7', 'B) 9', 'C) 10', 'D) 11', 'E) 12'] },
      { n: 5, topic: 'Usler', lines: ['2^x = 32 ve 3^y = 27 olduguna gore x + y', 'toplami kactir?'], options: ['A) 6', 'B) 7', 'C) 8', 'D) 9', 'E) 10'] },
      { n: 6, topic: 'Carpanlara ayirma', lines: ['x^2 + 2x - 15 ifadesinin carpanlarina ayrilmis', 'bicimi asagidakilerden hangisidir?'], options: ['A) (x+3)(x-5)', 'B) (x+5)(x-3)', 'C) (x+1)(x-15)', 'D) (x-3)(x-5)', 'E) (x+2)(x-7)'] },
    ],
    [
      { n: 7, topic: 'Problemler', lines: ['Bir urunun fiyati once %20 artiriliyor, sonra yeni fiyat', '%25 indiriliyor. Son fiyat ilk fiyata gore nasildir?'], options: ['A) %10 dusuk', 'B) Ayni', 'C) %5 yuksek', 'D) %10 yuksek', 'E) %20 yuksek'] },
      { n: 8, topic: 'Fonksiyonlar', lines: ['f(x) = x^2 - 4x + 1 fonksiyonunun alabilecegi en', 'kucuk deger kactir?'], options: ['A) -5', 'B) -4', 'C) -3', 'D) -2', 'E) 0'] },
      { n: 9, topic: 'Oran - Oranti', lines: ['Bir siniftaki kizlarin erkeklere orani 3/5 ve sinifta', '32 ogrenci olduguna gore kac kiz ogrenci vardir?'], options: ['A) 10', 'B) 12', 'C) 14', 'D) 16', 'E) 20'] },
    ],
    [
      { n: 10, topic: 'Kumeler', lines: ['A = {1, 2, 3, 4, 5} ve B = {3, 4, 5, 6} ise', 's(A kesim B) kactir?'], options: ['A) 1', 'B) 2', 'C) 3', 'D) 4', 'E) 5'] },
      { n: 11, topic: 'Diziler', lines: ['Bir aritmetik dizinin ilk terimi 4, ortak farki 3\'tur.', 'Dizinin 8. terimi kactir?'], options: ['A) 22', 'B) 24', 'C) 25', 'D) 27', 'E) 28'] },
      { n: 12, topic: 'Olasilik', lines: ['Bir zar bir kez atiliyor. Ust yuze gelen sayinin cift', 'olma olasiligi kactir?'], options: ['A) 1/6', 'B) 1/3', 'C) 1/2', 'D) 2/3', 'E) 5/6'] },
    ],
  ];

  pagesData.forEach((questions, pageIndex) => {
    const page = pdf.addPage([595.28, 841.89]);
    const W = page.getWidth(), H = page.getHeight();
    page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: blue });
    page.drawText('YKS  /  SAYISAL', { x: 45, y: H - 43, size: 8.5, font: bold, color: blue, characterSpacing: 1.1 });
    page.drawText('Matematik  /  Deneme 07', { x: 45, y: H - 76, size: 22, font: bold, color: navy });
    page.drawText('12 soru  ·  Hedef sure: 25 dk', { x: 46, y: H - 96, size: 9, font: regular, color: muted });
    page.drawRectangle({ x: W - 92, y: H - 78, width: 47, height: 24, color: pale, borderColor: rgb(0.87,0.88,0.98), borderWidth: 0.8 });
    page.drawText('TYT', { x: W - 79, y: H - 70, size: 10, font: bold, color: blue });
    page.drawLine({ start: { x: 45, y: H - 113 }, end: { x: W - 45, y: H - 113 }, thickness: 0.9, color: line });
    page.drawText(`KONU: ${questions.map(q => q.topic.toUpperCase()).join('  ·  ')}`, { x: 45, y: H - 134, size: 7.5, font: bold, color: muted, characterSpacing: 0.35 });
    page.drawText(`${String(pageIndex + 1).padStart(2, '0')} / 04`, { x: W - 84, y: H - 134, size: 8, font: bold, color: muted });

    const topYs = [H - 173, H - 390, H - 607];
    questions.forEach((q, i) => {
      const y = topYs[i];
      page.drawRectangle({ x: 45, y: y - 1, width: 28, height: 20, color: pale, borderColor: rgb(0.87,0.88,0.98), borderWidth: 0.5 });
      page.drawText(`Soru ${q.n}`, { x: 50, y: y + 5, size: 8.2, font: bold, color: blue });
      page.drawText(q.topic.toUpperCase(), { x: 85, y: y + 5, size: 7.3, font: bold, color: muted, characterSpacing: 0.65 });
      page.drawText(q.lines[0], { x: 45, y: y - 31, size: 10.6, font: regular, color: navy });
      page.drawText(q.lines[1], { x: 45, y: y - 49, size: 10.6, font: regular, color: navy });
      const optionY = y - 79;
      const colGap = (W - 90) / 5;
      q.options.forEach((o, j) => {
        page.drawText(o, { x: 46 + j * colGap, y: optionY, size: 8.5, font: j === 0 ? bold : regular, color: j === 0 ? navy : muted });
      });
      if (i < 2) page.drawLine({ start: { x: 45, y: y - 102 }, end: { x: W - 45, y: y - 102 }, thickness: 0.45, color: line });
    });
    page.drawText('Cevaplarini isaretle, cozumlerini bos alana yaz.', { x: 45, y: 36, size: 7.5, font: regular, color: muted });
    page.drawText('COZUM  /  ORNEK SORU BANKASI', { x: W - 202, y: 36, size: 7.2, font: bold, color: muted, characterSpacing: 0.55 });
  });

  fs.writeFileSync('./assets/demo.pdf', await pdf.save());
})();
