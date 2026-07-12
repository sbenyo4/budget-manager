import type { Transaction } from "../types";

/**
 * Demo data for July 2026 — used until the open-finance.ai credentials are
 * configured in .env. Categories follow the real API taxonomy so the
 * classification rules run identically on demo and live data.
 */
export const demoTransactions: Transaction[] = [
  // — income (for the monthly salary-to-salary view) —
  { id: "s1", date: "2026-06-10", merchant: "משכורת — אקמי בע\"מ", amount: 14200, type: "income", categoryMain: "SALARY", categorySub: "SALARY_OTHER", recurring: true },
  { id: "s2", date: "2026-07-10", merchant: "משכורת — אקמי בע\"מ", amount: 14200, type: "income", categoryMain: "SALARY", categorySub: "SALARY_OTHER", recurring: true },
  { id: "s3", date: "2026-06-22", merchant: "החזר ביטוח לאומי", amount: 380, type: "income", categoryMain: "REIMBURSEMENTS", categorySub: "REIMBURSEMENTS_OTHER" },

  // — June expenses (previous salary period) —
  { id: "j1", date: "2026-06-11", merchant: "שכר דירה", amount: 4500, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "RENT", recurring: true },
  { id: "j2", date: "2026-06-13", merchant: "שופרסל דיל", amount: 640, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "j3", date: "2026-06-15", merchant: "חברת החשמל", amount: 510, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "UTILITIES", recurring: true },
  { id: "j4", date: "2026-06-18", merchant: "מסעדת האחים", amount: 310, categoryMain: "FOOD_&_DRINKS", categorySub: "RESTAURANT" },
  { id: "j5", date: "2026-06-20", merchant: "דלק פז", amount: 360, categoryMain: "TRANSPORT", categorySub: "CAR_&_FUEL" },
  { id: "j6", date: "2026-06-25", merchant: "זארה", amount: 420, categoryMain: "SHOPPING", categorySub: "CLOTHES_&_ACCESSORIES" },
  { id: "j7", date: "2026-06-28", merchant: "שופרסל דיל", amount: 580, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },

  // — mandatory: recurring bills —
  { id: "m1", date: "2026-07-01", merchant: "שכר דירה", amount: 4500, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "RENT", recurring: true },
  { id: "m2", date: "2026-07-02", merchant: "עיריית תל אביב — ארנונה", amount: 620, categoryMain: "FINANCE", categorySub: "FEES", recurring: true },
  { id: "m3", date: "2026-07-05", merchant: "חברת החשמל", amount: 480, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "UTILITIES", recurring: true },
  { id: "m4", date: "2026-07-05", merchant: "מי אביבים", amount: 130, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "UTILITIES", recurring: true },
  { id: "m5", date: "2026-07-10", merchant: "הראל ביטוח בריאות", amount: 320, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "INSURANCE_&_FEES", recurring: true },
  { id: "m6", date: "2026-07-10", merchant: "פרטנר סלולר", amount: 45, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "COMMUNICATIONS", recurring: true },
  { id: "m7", date: "2026-07-12", merchant: "בזק אינטרנט", amount: 129, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "COMMUNICATIONS", recurring: true },
  { id: "m8", date: "2026-07-15", merchant: "ביטוח רכב — שלמה", amount: 410, categoryMain: "HOUSEHOLD_&_SERVICES", categorySub: "INSURANCE_&_FEES", recurring: true },
  { id: "m9", date: "2026-07-20", merchant: "החזר הלוואה — לאומי", amount: 950, categoryMain: "FINANCE", categorySub: "LOANS", recurring: true },
  { id: "m10", date: "2026-07-25", merchant: "קופת חולים כללית", amount: 89, categoryMain: "HEALTH_&_BEAUTY", categorySub: "HEALTHCARE", recurring: true },

  // — mandatory: essentials —
  { id: "g1", date: "2026-07-03", merchant: "שופרסל דיל", amount: 612, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "g2", date: "2026-07-10", merchant: "שופרסל דיל", amount: 548, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "g3", date: "2026-07-17", merchant: "שופרסל דיל", amount: 590, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "g4", date: "2026-07-24", merchant: "שופרסל דיל", amount: 575, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "g5", date: "2026-07-31", merchant: "שופרסל דיל", amount: 630, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "g6", date: "2026-07-07", merchant: "דלק פז", amount: 350, categoryMain: "TRANSPORT", categorySub: "CAR_&_FUEL" },
  { id: "g7", date: "2026-07-21", merchant: "דלק פז", amount: 340, categoryMain: "TRANSPORT", categorySub: "CAR_&_FUEL" },
  { id: "g8", date: "2026-07-14", merchant: "סופר פארם", amount: 145, categoryMain: "HEALTH_&_BEAUTY", categorySub: "PHARMACY" },

  // — discretionary: the ones to avoid in No Buy July —
  { id: "d1", date: "2026-07-01", merchant: "Netflix", amount: 55, categoryMain: "LEISURE", categorySub: "HOBBIES", recurring: true },
  { id: "d2", date: "2026-07-03", merchant: "Spotify", amount: 25, categoryMain: "LEISURE", categorySub: "HOBBIES", recurring: true },
  { id: "d3", date: "2026-07-04", merchant: "וולט — משלוח", amount: 124, categoryMain: "FOOD_&_DRINKS", categorySub: "RESTAURANT" },
  { id: "d4", date: "2026-07-08", merchant: "מסעדת האחים", amount: 280, categoryMain: "FOOD_&_DRINKS", categorySub: "RESTAURANT" },
  { id: "d5", date: "2026-07-09", merchant: "זארה", amount: 349, categoryMain: "SHOPPING", categorySub: "CLOTHES_&_ACCESSORIES" },
  { id: "d6", date: "2026-07-11", merchant: "am:pm", amount: 42, categoryMain: "FOOD_&_DRINKS", categorySub: "GROCERIES" },
  { id: "d7", date: "2026-07-14", merchant: "Amazon", amount: 220, categoryMain: "SHOPPING", categorySub: "SHOPPING_OTHER" },
  { id: "d8", date: "2026-07-16", merchant: "קפה ומאפה — ארומה", amount: 48, categoryMain: "FOOD_&_DRINKS", categorySub: "COFFEE_&_SNACKS" },
  { id: "d9", date: "2026-07-18", merchant: "סינמה סיטי", amount: 110, categoryMain: "LEISURE", categorySub: "CULTURE_&_EVENTS" },
  { id: "d10", date: "2026-07-22", merchant: "וולט — משלוח", amount: 95, categoryMain: "FOOD_&_DRINKS", categorySub: "RESTAURANT" },
  { id: "d11", date: "2026-07-25", merchant: "איקאה", amount: 480, categoryMain: "HOME_IMPROVEMENTS", categorySub: "FURNITURE_&_INTERIOR" },
  { id: "d12", date: "2026-07-28", merchant: "מסעדת הבית", amount: 320, categoryMain: "FOOD_&_DRINKS", categorySub: "RESTAURANT" },
];
