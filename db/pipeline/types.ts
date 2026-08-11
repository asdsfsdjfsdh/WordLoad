export interface RawWord {
  wordid: number;
  spelling: string;
  UKphonetic: string | null;
  USphonetic: string | null;
  paraphrase: string | null;
  frequency: number;
}

export interface RawExample {
  expaid: number;
  wordid: number;
  en: string;
  cn: string;
  heat: number;
  adddate: string;
}

export interface RawBook {
  bookid: number;
  bookname: string;
  voccount: number;
  status: string | null;
}

export interface RawBookWord {
  vocbkid: number;
  wordid: number;
  bookid: number;
}