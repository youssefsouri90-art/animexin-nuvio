// Mapple (mapple.fun) provider for Nuvio (QuickJS: no DOM, no Node APIs).
// Flow: cookie -> POST /api/ui/session -> POST /api/media-session (proof of work)
//       -> POST /api/encrypt -> GET /api/stream-encrypted -> m3u8
// The media token lives ~120 s, so everything runs in one getStreams() call.
// ---------- proof of work (SHA-256 hashcash, optimized for QuickJS) ----------
// Finds nonce such that SHA256(challenge + String(nonce)) has >= difficulty leading zero bits.
// The 64-char challenge is exactly one SHA-256 block, so its state is precomputed once and
// each attempt costs a single (unrolled) compression.
var SHA_K = [1116352408, 1899447441, -1245643825, -373957723, 961987163, 1508970993, -1841331548, -1424204075, -670586216, 310598401, 607225278, 1426881987, 1925078388, -2132889090, -1680079193, -1046744716, -459576895, -272742522, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, -1740746414, -1473132947, -1341970488, -1084653625, -958395405, -710438585, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, -2117940946, -1838011259, -1564481375, -1474664885, -1035236496, -949202525, -778901479, -694614492, -200395387, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, -2067236844, -1933114872, -1866530822, -1538233109, -1090935817, -965641998];
var SHA_IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
var MID = [0, 0, 0, 0, 0, 0, 0, 0];

function shaCompress(state, w) {
  var W = new Array(64), i;
  for (i = 0; i < 16; i++) W[i] = w[i] | 0;
  for (i = 16; i < 64; i++) {
    var x = W[i - 15], y = W[i - 2];
    var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  var a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
  for (i = 0; i < 64; i++) {
    var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    var ch = (e & f) ^ (~e & g);
    var t1 = (h + S1 + ch + SHA_K[i] + W[i]) | 0;
    var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    var mj = (a & b) ^ (a & c) ^ (b & c);
    var t2 = (S0 + mj) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return [(state[0] + a) | 0, (state[1] + b) | 0, (state[2] + c) | 0, (state[3] + d) | 0,
          (state[4] + e) | 0, (state[5] + f) | 0, (state[6] + g) | 0, (state[7] + h) | 0];
}

function powBlock2(s) { // second block words for message = challenge(64 bytes) + s
  var bytes = [], i;
  for (i = 0; i < 64; i++) bytes.push(0);
  for (i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 255;
  bytes[s.length] = 0x80;
  var w = [];
  for (i = 0; i < 16; i++) w.push((bytes[4 * i] << 24) | (bytes[4 * i + 1] << 16) | (bytes[4 * i + 2] << 8) | bytes[4 * i + 3]);
  w[15] = (64 + s.length) * 8;
  return w;
}

// unrolled compression of block 2 (words 4..14 are zero); returns first output word
function powFirstWord(w0, w1, w2, w3, w15) {
  var m0=MID[0],m1=MID[1],m2=MID[2],m3=MID[3],m4=MID[4],m5=MID[5],m6=MID[6],m7=MID[7];
  var w4=0;
  var w5=0;
  var w6=0;
  var w7=0;
  var w8=0;
  var w9=0;
  var w10=0;
  var w11=0;
  var w12=0;
  var w13=0;
  var w14=0;
  var w16=(w0+(((w1>>>7)|(w1<<25))^((w1>>>18)|(w1<<14))^(w1>>>3))+w9+(((w14>>>17)|(w14<<15))^((w14>>>19)|(w14<<13))^(w14>>>10)))|0;
  var w17=(w1+(((w2>>>7)|(w2<<25))^((w2>>>18)|(w2<<14))^(w2>>>3))+w10+(((w15>>>17)|(w15<<15))^((w15>>>19)|(w15<<13))^(w15>>>10)))|0;
  var w18=(w2+(((w3>>>7)|(w3<<25))^((w3>>>18)|(w3<<14))^(w3>>>3))+w11+(((w16>>>17)|(w16<<15))^((w16>>>19)|(w16<<13))^(w16>>>10)))|0;
  var w19=(w3+(((w4>>>7)|(w4<<25))^((w4>>>18)|(w4<<14))^(w4>>>3))+w12+(((w17>>>17)|(w17<<15))^((w17>>>19)|(w17<<13))^(w17>>>10)))|0;
  var w20=(w4+(((w5>>>7)|(w5<<25))^((w5>>>18)|(w5<<14))^(w5>>>3))+w13+(((w18>>>17)|(w18<<15))^((w18>>>19)|(w18<<13))^(w18>>>10)))|0;
  var w21=(w5+(((w6>>>7)|(w6<<25))^((w6>>>18)|(w6<<14))^(w6>>>3))+w14+(((w19>>>17)|(w19<<15))^((w19>>>19)|(w19<<13))^(w19>>>10)))|0;
  var w22=(w6+(((w7>>>7)|(w7<<25))^((w7>>>18)|(w7<<14))^(w7>>>3))+w15+(((w20>>>17)|(w20<<15))^((w20>>>19)|(w20<<13))^(w20>>>10)))|0;
  var w23=(w7+(((w8>>>7)|(w8<<25))^((w8>>>18)|(w8<<14))^(w8>>>3))+w16+(((w21>>>17)|(w21<<15))^((w21>>>19)|(w21<<13))^(w21>>>10)))|0;
  var w24=(w8+(((w9>>>7)|(w9<<25))^((w9>>>18)|(w9<<14))^(w9>>>3))+w17+(((w22>>>17)|(w22<<15))^((w22>>>19)|(w22<<13))^(w22>>>10)))|0;
  var w25=(w9+(((w10>>>7)|(w10<<25))^((w10>>>18)|(w10<<14))^(w10>>>3))+w18+(((w23>>>17)|(w23<<15))^((w23>>>19)|(w23<<13))^(w23>>>10)))|0;
  var w26=(w10+(((w11>>>7)|(w11<<25))^((w11>>>18)|(w11<<14))^(w11>>>3))+w19+(((w24>>>17)|(w24<<15))^((w24>>>19)|(w24<<13))^(w24>>>10)))|0;
  var w27=(w11+(((w12>>>7)|(w12<<25))^((w12>>>18)|(w12<<14))^(w12>>>3))+w20+(((w25>>>17)|(w25<<15))^((w25>>>19)|(w25<<13))^(w25>>>10)))|0;
  var w28=(w12+(((w13>>>7)|(w13<<25))^((w13>>>18)|(w13<<14))^(w13>>>3))+w21+(((w26>>>17)|(w26<<15))^((w26>>>19)|(w26<<13))^(w26>>>10)))|0;
  var w29=(w13+(((w14>>>7)|(w14<<25))^((w14>>>18)|(w14<<14))^(w14>>>3))+w22+(((w27>>>17)|(w27<<15))^((w27>>>19)|(w27<<13))^(w27>>>10)))|0;
  var w30=(w14+(((w15>>>7)|(w15<<25))^((w15>>>18)|(w15<<14))^(w15>>>3))+w23+(((w28>>>17)|(w28<<15))^((w28>>>19)|(w28<<13))^(w28>>>10)))|0;
  var w31=(w15+(((w16>>>7)|(w16<<25))^((w16>>>18)|(w16<<14))^(w16>>>3))+w24+(((w29>>>17)|(w29<<15))^((w29>>>19)|(w29<<13))^(w29>>>10)))|0;
  var w32=(w16+(((w17>>>7)|(w17<<25))^((w17>>>18)|(w17<<14))^(w17>>>3))+w25+(((w30>>>17)|(w30<<15))^((w30>>>19)|(w30<<13))^(w30>>>10)))|0;
  var w33=(w17+(((w18>>>7)|(w18<<25))^((w18>>>18)|(w18<<14))^(w18>>>3))+w26+(((w31>>>17)|(w31<<15))^((w31>>>19)|(w31<<13))^(w31>>>10)))|0;
  var w34=(w18+(((w19>>>7)|(w19<<25))^((w19>>>18)|(w19<<14))^(w19>>>3))+w27+(((w32>>>17)|(w32<<15))^((w32>>>19)|(w32<<13))^(w32>>>10)))|0;
  var w35=(w19+(((w20>>>7)|(w20<<25))^((w20>>>18)|(w20<<14))^(w20>>>3))+w28+(((w33>>>17)|(w33<<15))^((w33>>>19)|(w33<<13))^(w33>>>10)))|0;
  var w36=(w20+(((w21>>>7)|(w21<<25))^((w21>>>18)|(w21<<14))^(w21>>>3))+w29+(((w34>>>17)|(w34<<15))^((w34>>>19)|(w34<<13))^(w34>>>10)))|0;
  var w37=(w21+(((w22>>>7)|(w22<<25))^((w22>>>18)|(w22<<14))^(w22>>>3))+w30+(((w35>>>17)|(w35<<15))^((w35>>>19)|(w35<<13))^(w35>>>10)))|0;
  var w38=(w22+(((w23>>>7)|(w23<<25))^((w23>>>18)|(w23<<14))^(w23>>>3))+w31+(((w36>>>17)|(w36<<15))^((w36>>>19)|(w36<<13))^(w36>>>10)))|0;
  var w39=(w23+(((w24>>>7)|(w24<<25))^((w24>>>18)|(w24<<14))^(w24>>>3))+w32+(((w37>>>17)|(w37<<15))^((w37>>>19)|(w37<<13))^(w37>>>10)))|0;
  var w40=(w24+(((w25>>>7)|(w25<<25))^((w25>>>18)|(w25<<14))^(w25>>>3))+w33+(((w38>>>17)|(w38<<15))^((w38>>>19)|(w38<<13))^(w38>>>10)))|0;
  var w41=(w25+(((w26>>>7)|(w26<<25))^((w26>>>18)|(w26<<14))^(w26>>>3))+w34+(((w39>>>17)|(w39<<15))^((w39>>>19)|(w39<<13))^(w39>>>10)))|0;
  var w42=(w26+(((w27>>>7)|(w27<<25))^((w27>>>18)|(w27<<14))^(w27>>>3))+w35+(((w40>>>17)|(w40<<15))^((w40>>>19)|(w40<<13))^(w40>>>10)))|0;
  var w43=(w27+(((w28>>>7)|(w28<<25))^((w28>>>18)|(w28<<14))^(w28>>>3))+w36+(((w41>>>17)|(w41<<15))^((w41>>>19)|(w41<<13))^(w41>>>10)))|0;
  var w44=(w28+(((w29>>>7)|(w29<<25))^((w29>>>18)|(w29<<14))^(w29>>>3))+w37+(((w42>>>17)|(w42<<15))^((w42>>>19)|(w42<<13))^(w42>>>10)))|0;
  var w45=(w29+(((w30>>>7)|(w30<<25))^((w30>>>18)|(w30<<14))^(w30>>>3))+w38+(((w43>>>17)|(w43<<15))^((w43>>>19)|(w43<<13))^(w43>>>10)))|0;
  var w46=(w30+(((w31>>>7)|(w31<<25))^((w31>>>18)|(w31<<14))^(w31>>>3))+w39+(((w44>>>17)|(w44<<15))^((w44>>>19)|(w44<<13))^(w44>>>10)))|0;
  var w47=(w31+(((w32>>>7)|(w32<<25))^((w32>>>18)|(w32<<14))^(w32>>>3))+w40+(((w45>>>17)|(w45<<15))^((w45>>>19)|(w45<<13))^(w45>>>10)))|0;
  var w48=(w32+(((w33>>>7)|(w33<<25))^((w33>>>18)|(w33<<14))^(w33>>>3))+w41+(((w46>>>17)|(w46<<15))^((w46>>>19)|(w46<<13))^(w46>>>10)))|0;
  var w49=(w33+(((w34>>>7)|(w34<<25))^((w34>>>18)|(w34<<14))^(w34>>>3))+w42+(((w47>>>17)|(w47<<15))^((w47>>>19)|(w47<<13))^(w47>>>10)))|0;
  var w50=(w34+(((w35>>>7)|(w35<<25))^((w35>>>18)|(w35<<14))^(w35>>>3))+w43+(((w48>>>17)|(w48<<15))^((w48>>>19)|(w48<<13))^(w48>>>10)))|0;
  var w51=(w35+(((w36>>>7)|(w36<<25))^((w36>>>18)|(w36<<14))^(w36>>>3))+w44+(((w49>>>17)|(w49<<15))^((w49>>>19)|(w49<<13))^(w49>>>10)))|0;
  var w52=(w36+(((w37>>>7)|(w37<<25))^((w37>>>18)|(w37<<14))^(w37>>>3))+w45+(((w50>>>17)|(w50<<15))^((w50>>>19)|(w50<<13))^(w50>>>10)))|0;
  var w53=(w37+(((w38>>>7)|(w38<<25))^((w38>>>18)|(w38<<14))^(w38>>>3))+w46+(((w51>>>17)|(w51<<15))^((w51>>>19)|(w51<<13))^(w51>>>10)))|0;
  var w54=(w38+(((w39>>>7)|(w39<<25))^((w39>>>18)|(w39<<14))^(w39>>>3))+w47+(((w52>>>17)|(w52<<15))^((w52>>>19)|(w52<<13))^(w52>>>10)))|0;
  var w55=(w39+(((w40>>>7)|(w40<<25))^((w40>>>18)|(w40<<14))^(w40>>>3))+w48+(((w53>>>17)|(w53<<15))^((w53>>>19)|(w53<<13))^(w53>>>10)))|0;
  var w56=(w40+(((w41>>>7)|(w41<<25))^((w41>>>18)|(w41<<14))^(w41>>>3))+w49+(((w54>>>17)|(w54<<15))^((w54>>>19)|(w54<<13))^(w54>>>10)))|0;
  var w57=(w41+(((w42>>>7)|(w42<<25))^((w42>>>18)|(w42<<14))^(w42>>>3))+w50+(((w55>>>17)|(w55<<15))^((w55>>>19)|(w55<<13))^(w55>>>10)))|0;
  var w58=(w42+(((w43>>>7)|(w43<<25))^((w43>>>18)|(w43<<14))^(w43>>>3))+w51+(((w56>>>17)|(w56<<15))^((w56>>>19)|(w56<<13))^(w56>>>10)))|0;
  var w59=(w43+(((w44>>>7)|(w44<<25))^((w44>>>18)|(w44<<14))^(w44>>>3))+w52+(((w57>>>17)|(w57<<15))^((w57>>>19)|(w57<<13))^(w57>>>10)))|0;
  var w60=(w44+(((w45>>>7)|(w45<<25))^((w45>>>18)|(w45<<14))^(w45>>>3))+w53+(((w58>>>17)|(w58<<15))^((w58>>>19)|(w58<<13))^(w58>>>10)))|0;
  var w61=(w45+(((w46>>>7)|(w46<<25))^((w46>>>18)|(w46<<14))^(w46>>>3))+w54+(((w59>>>17)|(w59<<15))^((w59>>>19)|(w59<<13))^(w59>>>10)))|0;
  var w62=(w46+(((w47>>>7)|(w47<<25))^((w47>>>18)|(w47<<14))^(w47>>>3))+w55+(((w60>>>17)|(w60<<15))^((w60>>>19)|(w60<<13))^(w60>>>10)))|0;
  var w63=(w47+(((w48>>>7)|(w48<<25))^((w48>>>18)|(w48<<14))^(w48>>>3))+w56+(((w61>>>17)|(w61<<15))^((w61>>>19)|(w61<<13))^(w61>>>10)))|0;
  var a=m0,b=m1,c=m2,d=m3,e=m4,f=m5,g=m6,h=m7,t1=0,t2=0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+1116352408+w0)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+1899447441+w1)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+-1245643825+w2)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+-373957723+w3)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+961987163+w4)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+1508970993+w5)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+-1841331548+w6)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+-1424204075+w7)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+-670586216+w8)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+310598401+w9)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+607225278+w10)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+1426881987+w11)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+1925078388+w12)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+-2132889090+w13)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+-1680079193+w14)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+-1046744716+w15)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+-459576895+w16)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+-272742522+w17)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+264347078+w18)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+604807628+w19)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+770255983+w20)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+1249150122+w21)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+1555081692+w22)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+1996064986+w23)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+-1740746414+w24)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+-1473132947+w25)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+-1341970488+w26)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+-1084653625+w27)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+-958395405+w28)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+-710438585+w29)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+113926993+w30)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+338241895+w31)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+666307205+w32)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+773529912+w33)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+1294757372+w34)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+1396182291+w35)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+1695183700+w36)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+1986661051+w37)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+-2117940946+w38)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+-1838011259+w39)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+-1564481375+w40)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+-1474664885+w41)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+-1035236496+w42)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+-949202525+w43)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+-778901479+w44)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+-694614492+w45)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+-200395387+w46)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+275423344+w47)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+430227734+w48)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+506948616+w49)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+659060556+w50)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+883997877+w51)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+958139571+w52)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+1322822218+w53)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+1537002063+w54)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+1747873779+w55)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  t1=(h+(((e>>>6)|(e<<26))^((e>>>11)|(e<<21))^((e>>>25)|(e<<7)))+((e&f)^(~e&g))+1955562222+w56)|0; t2=((((a>>>2)|(a<<30))^((a>>>13)|(a<<19))^((a>>>22)|(a<<10)))+((a&b)^(a&c)^(b&c)))|0; d=(d+t1)|0; h=(t1+t2)|0;
  t1=(g+(((d>>>6)|(d<<26))^((d>>>11)|(d<<21))^((d>>>25)|(d<<7)))+((d&e)^(~d&f))+2024104815+w57)|0; t2=((((h>>>2)|(h<<30))^((h>>>13)|(h<<19))^((h>>>22)|(h<<10)))+((h&a)^(h&b)^(a&b)))|0; c=(c+t1)|0; g=(t1+t2)|0;
  t1=(f+(((c>>>6)|(c<<26))^((c>>>11)|(c<<21))^((c>>>25)|(c<<7)))+((c&d)^(~c&e))+-2067236844+w58)|0; t2=((((g>>>2)|(g<<30))^((g>>>13)|(g<<19))^((g>>>22)|(g<<10)))+((g&h)^(g&a)^(h&a)))|0; b=(b+t1)|0; f=(t1+t2)|0;
  t1=(e+(((b>>>6)|(b<<26))^((b>>>11)|(b<<21))^((b>>>25)|(b<<7)))+((b&c)^(~b&d))+-1933114872+w59)|0; t2=((((f>>>2)|(f<<30))^((f>>>13)|(f<<19))^((f>>>22)|(f<<10)))+((f&g)^(f&h)^(g&h)))|0; a=(a+t1)|0; e=(t1+t2)|0;
  t1=(d+(((a>>>6)|(a<<26))^((a>>>11)|(a<<21))^((a>>>25)|(a<<7)))+((a&b)^(~a&c))+-1866530822+w60)|0; t2=((((e>>>2)|(e<<30))^((e>>>13)|(e<<19))^((e>>>22)|(e<<10)))+((e&f)^(e&g)^(f&g)))|0; h=(h+t1)|0; d=(t1+t2)|0;
  t1=(c+(((h>>>6)|(h<<26))^((h>>>11)|(h<<21))^((h>>>25)|(h<<7)))+((h&a)^(~h&b))+-1538233109+w61)|0; t2=((((d>>>2)|(d<<30))^((d>>>13)|(d<<19))^((d>>>22)|(d<<10)))+((d&e)^(d&f)^(e&f)))|0; g=(g+t1)|0; c=(t1+t2)|0;
  t1=(b+(((g>>>6)|(g<<26))^((g>>>11)|(g<<21))^((g>>>25)|(g<<7)))+((g&h)^(~g&a))+-1090935817+w62)|0; t2=((((c>>>2)|(c<<30))^((c>>>13)|(c<<19))^((c>>>22)|(c<<10)))+((c&d)^(c&e)^(d&e)))|0; f=(f+t1)|0; b=(t1+t2)|0;
  t1=(a+(((f>>>6)|(f<<26))^((f>>>11)|(f<<21))^((f>>>25)|(f<<7)))+((f&g)^(~f&h))+-965641998+w63)|0; t2=((((b>>>2)|(b<<30))^((b>>>13)|(b<<19))^((b>>>22)|(b<<10)))+((b&c)^(b&d)^(c&d)))|0; e=(e+t1)|0; a=(t1+t2)|0;
  return (m0+a)|0;
}

function leadingZeroBits32(x) {
  return x === 0 ? 32 : Math.clz32(x);
}

function solvePow(challenge, difficulty, maxIter) {
  var first = [], i;
  for (i = 0; i < 16; i++) {
    first.push((challenge.charCodeAt(4 * i) << 24) | (challenge.charCodeAt(4 * i + 1) << 16) |
               (challenge.charCodeAt(4 * i + 2) << 8) | challenge.charCodeAt(4 * i + 3));
  }
  var mid = shaCompress(SHA_IV, first);
  for (i = 0; i < 8; i++) MID[i] = mid[i];
  var limit = maxIter || 60000000;
  var shift = 32 - Math.min(difficulty, 32);
  for (var n = 0; n < limit; n++) {
    var s = String(n);
    // words 0..3 of block 2 (nonce up to 15 digits)
    var b = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], L = s.length;
    for (i = 0; i < L; i++) b[i] = s.charCodeAt(i) & 255;
    b[L] = 0x80;
    var w0 = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    var w1 = (b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7];
    var w2 = (b[8] << 24) | (b[9] << 16) | (b[10] << 8) | b[11];
    var w3 = (b[12] << 24) | (b[13] << 16) | (b[14] << 8) | b[15];
    var h0 = powFirstWord(w0, w1, w2, w3, (64 + L) * 8);
    if (difficulty <= 32) {
      if ((h0 >>> shift) === 0 || (difficulty === 0)) return n;
    } else if (h0 === 0) {
      // need more than 32 bits: verify with the generic path
      var full = shaCompress(mid, powBlock2(s));
      if (leadingZeroBits32(full[0]) + (full[0] === 0 ? leadingZeroBits32(full[1]) : 0) >= difficulty) return n;
    }
  }
  return -1;
}

// ================= Mapple provider =================
const BASE = "https://mapple.fun";
const UA = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
};
const BROWSER = Object.assign({}, UA, {
  Accept: "*/*",
  "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="140", "Not=A?Brand";v="24", "Google Chrome";v="140"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  Origin: BASE,
  Referer: BASE + "/",
});

// Source ids tried in order (names are unknown, the site serves them as s1..s13).
// Known from tests: s5 and s13 disabled, s11 unknown. Stops after MAX_OK working sources.
const SOURCES = ["s1", "s8", "s2", "s3", "s4", "s9", "s10", "s12", "s6", "s7"];
const MAX_OK = 3;
const SITE_SUBS = true;
const PROBE = true; // writes the HTTP status of the final link into the stream name (debug)

const DIAG = [];

function hostOf(u) {
  const m = /^https?:\/\/([^\/?#]+)/i.exec(u);
  return m ? m[1] : u;
}
function absUrl(base, rel) {
  if (/^https?:/i.test(rel)) return rel;
  if (rel[0] === "/") return base.replace(/^(https?:\/\/[^\/]+).*/, "$1") + rel;
  return base.replace(/[^\/]*$/, "") + rel;
}
function qualityLabel(h) {
  if (h >= 2000) return "2160p (4K)";
  if (h >= 1400) return "1440p";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 460) return "480p";
  if (h >= 340) return "360p";
  return h + "p";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- session (cookie + request token) ----------
function createSession() { return { cookie: "", requestToken: "" }; }

async function api(sess, method, path, body) {
  const h = Object.assign({}, BROWSER);
  if (sess.cookie) h.Cookie = sess.cookie;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const r = await fetch(path.indexOf("http") === 0 ? path : BASE + path, {
    method: method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, text: text, json: json };
}

async function openSession(pagePath) {
  const sess = createSession();
  try {
    const r = await fetch(BASE + pagePath, { headers: UA });
    const sc = (r.headers && r.headers.get && r.headers.get("set-cookie")) || "";
    const m = /_mapple_site=([^;,\s]+)/.exec(sc);
    const p = /_mapple_site_partitioned=([^;,\s]+)/.exec(sc);
    const parts = [];
    if (m) parts.push("_mapple_site=" + m[1]);
    if (p) parts.push("_mapple_site_partitioned=" + p[1]);
    sess.cookie = parts.join("; ");
    DIAG.push("cookie=" + (sess.cookie ? "yes" : "none"));
    await r.text();
  } catch (e) { DIAG.push("page err"); }
  if (sess.cookie) await sleep(1500); // fresh cookies were accepted after a short pause in tests
  const s = await api(sess, "POST", "/api/ui/session", {});
  sess.requestToken = s.json && s.json.token;
  if (!sess.requestToken) DIAG.push("session " + s.status + " " + String(s.text).slice(0, 40));
  return sess.requestToken ? sess : null;
}

// media-session token: proof of work, valid ~120 s
async function getMediaToken(sess, id, type, scope) {
  const base = { mediaId: id, mediaType: type, mediaScope: scope, requestToken: sess.requestToken };
  const c = await api(sess, "POST", "/api/media-session", base);
  if (!c.json || !c.json.pow) { DIAG.push("ms " + c.status + " " + String(c.text).slice(0, 40)); return ""; }
  const nonce = solvePow(c.json.pow.challenge, c.json.pow.difficulty);
  if (nonce < 0) { DIAG.push("pow unsolved"); return ""; }
  const m = await api(sess, "POST", "/api/media-session",
    Object.assign({}, base, { pow: { challengeId: c.json.pow.challengeId, nonce: String(nonce) } }));
  if (!m.json || !m.json.token) { DIAG.push("pow rejected " + m.status + " " + String(m.text).slice(0, 40)); return ""; }
  return m.json.token;
}

// one source -> { data } | { fail, retry, badToken }
async function fetchSource(sess, mtoken, id, type, scope, src) {
  const e = await api(sess, "POST", "/api/encrypt", {
    data: { mediaId: id, mediaType: type, tv_slug: scope, source: src },
    endpoint: "stream-encrypted",
    requestToken: sess.requestToken,
  });
  const url = e.json && e.json.url;
  if (!url) return { fail: "encrypt " + e.status };
  const r = await api(sess, "GET",
    url + "&requestToken=" + encodeURIComponent(sess.requestToken) + "&token=" + encodeURIComponent(mtoken));
  const j = r.json || {};
  const d = j.data || {};
  if (d.stream_url && !/playback-unavailable/.test(d.stream_url)) return { data: d };
  if (d.stream_url) return { fail: "token", badToken: true };
  return { fail: j.details || j.error || ("http" + r.status), retry: j.retryAfterSeconds };
}

// ---------- HLS ----------
async function expandHls(masterUrl, hdrs) {
  const out = [{ url: masterUrl, quality: "Auto", height: 0 }];
  try {
    const r = await fetch(masterUrl, { headers: hdrs });
    const txt = await r.text();
    if (txt.indexOf("#EXTM3U") !== 0) { DIAG.push("m3u8? " + r.status); return out; }
    if (txt.indexOf("#EXT-X-STREAM-INF") < 0) return out; // already a media playlist
    const lines = txt.split(/\r?\n/);
    const byHeight = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf("#EXT-X-STREAM-INF") !== 0) continue;
      let next = "";
      for (let k = i + 1; k < lines.length; k++) {
        const t = lines[k].trim();
        if (t && t[0] !== "#") { next = t; break; }
      }
      if (!next) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(line);
      if (!res) continue;
      const h = Math.max(parseInt(res[2], 10), Math.round((parseInt(res[1], 10) * 9) / 16));
      const bw = parseInt((/(?:^|[,:])BANDWIDTH=(\d+)/.exec(line) || [0, 0])[1], 10);
      if (!byHeight[h] || bw > byHeight[h].bw) byHeight[h] = { url: absUrl(masterUrl, next), bw: bw };
    }
    const hs = Object.keys(byHeight).map(Number).sort((x, y) => y - x);
    if (hs.length) {
      out[0].quality = "Auto (up to " + qualityLabel(hs[0]) + ")";
      out[0].height = hs[0];
      hs.forEach((h) => out.push({ url: byHeight[h].url, quality: qualityLabel(h), height: h }));
    }
  } catch (e) {}
  return out;
}

function toSubtitles(d) {
  const arr = (d && (d.subtitles || d.tracks || d.captions)) || [];
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach((t) => {
    const u = t && (t.url || t.file || t.src);
    if (!u) return;
    const label = String(t.label || t.lang || t.language || "und");
    const kind = String(t.kind || "").toLowerCase();
    if (kind === "thumbnails") return;
    const lang = String(t.lang || t.language || label).toLowerCase().slice(0, 2);
    out.push({ url: u, lang: lang, language: lang, label: label, name: label });
  });
  return out;
}

async function probe(url, hdrs) {
  try {
    const r = await fetch(url, { headers: hdrs });
    return String(r.status);
  } catch (e) { return "ERR"; }
}

// ---------- entry point ----------
async function getStreams(tmdbId, mediaType, season, episode) {
  const dbg = [];
  DIAG.length = 0;
  const fail = (m) => {
    const msg = dbg.concat(m, DIAG).join(" > ");
    const out = [];
    for (let i = 0; i < 6; i++) {
      const part = msg.slice(i * 60, (i + 1) * 60);
      if (!part) break;
      out.push({ name: "DBG" + (i + 1) + " " + part, title: msg, url: "https://debug.invalid/" + (i + 1), quality: "debug" });
    }
    return out;
  };

  try {
    const idStr = String(tmdbId).replace(/^tmdb:/i, "");
    if (!/^\d+$/.test(idStr)) return fail("unsupported id " + String(tmdbId).slice(0, 20));
    const id = Number(idStr);
    const isTv = mediaType !== "movie";
    const type = isTv ? "tv" : "movie";
    // TV scope format is UNVERIFIED (movies use an empty string): "<season>-<episode>"
    const scope = isTv ? (Number(season) || 1) + "-" + (Number(episode) || 1) : "";
    dbg.push(type + " " + id + (scope ? " " + scope : ""));

    const sess = await openSession(isTv ? "/watch/tv/" + id : "/watch/movie/" + id);
    if (!sess) return fail("no session");

    let mtoken = await getMediaToken(sess, id, type, scope);
    if (!mtoken) return fail("no media token");

    const found = [];
    for (let i = 0; i < SOURCES.length && found.length < MAX_OK; i++) {
      const src = SOURCES[i];
      let res = await fetchSource(sess, mtoken, id, type, scope, src);
      if (res.badToken) { // token expired or rejected: get a new one and retry once
        mtoken = await getMediaToken(sess, id, type, scope);
        if (!mtoken) break;
        res = await fetchSource(sess, mtoken, id, type, scope, src);
      }
      if (!res.data && /SOURCE_BUSY|TIMEOUT|COOLDOWN/.test(res.fail || "") && res.retry && res.retry <= 6) {
        await sleep(res.retry * 1000);
        res = await fetchSource(sess, mtoken, id, type, scope, src);
      }
      DIAG.push(src + ":" + (res.data ? "ok" : res.fail));
      if (res.data) found.push({ src: src, data: res.data });
    }
    if (!found.length) return fail("no source worked");

    const streams = [], seen = {};
    for (const f of found) {
      const su = f.data.stream_url;
      const full = absUrl(BASE + "/", su);
      const PH = Object.assign({}, UA, { Referer: BASE + "/", Origin: BASE });
      const subs = SITE_SUBS ? toSubtitles(f.data) : [];
      const links = /m3u8|playlist/i.test(full) ? await expandHls(full, PH) : [{ url: full, quality: "Direct", height: 0 }];
      links.sort((a, b) => (b.height || 0) - (a.height || 0));
      links.forEach((l) => {
        if (seen[l.url]) return;
        seen[l.url] = 1;
        const st = { name: "Mapple " + f.src, title: "Mapple " + f.src, url: l.url, quality: l.quality, headers: PH, provider: "mapple" };
        if (subs.length) st.subtitles = subs;
        streams.push(st);
      });
    }
    if (PROBE) {
      await Promise.all(streams.slice(0, 6).map(async (st) => {
        const res = await probe(st.url, st.headers);
        st.name = "Mapple [" + res + "] " + hostOf(st.url).slice(0, 12);
      }));
    }
    return streams.length ? streams : fail("no playable streams");
  } catch (e) {
    return fail("ERROR " + (e && e.message));
  }
}

module.exports = { getStreams, DIAG, solvePow };
