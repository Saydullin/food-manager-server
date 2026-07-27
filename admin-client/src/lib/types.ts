export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FoodNutrition {
  calories: number | null;
  servings: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

export interface FoodTags {
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  diets: string[];
}

export interface FoodTranslation {
  language: string;
  name: string;
  description: string | null;
  content: string | null;
}

export interface FoodIngredient {
  id: string;
  ingredientId: string;
  name: string;
  amount: number;
  unit: string;
}

export interface Food {
  id: string;
  translations: FoodTranslation[];
  cuisine: string | null;
  images: string[];
  nutrition: FoodNutrition | null;
  tags: FoodTags;
  ingredients: FoodIngredient[];
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  id: string;
  name: string;
}

export interface FoodFormOptions {
  cuisines: string[];
  diets: string[];
  allergens: string[];
  dietaryRestrictions: string[];
  intolerances: string[];
  features: string[];
  foodDiets: string[];
  languages: string[];
}

export interface AdminUserListItem {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  imageUrl: string | null;
  name: string | null;
  isBanned: boolean;
  bannedAt: string | null;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserListItem {
  age: number | null;
  status: string | null;
  description: string | null;
  interactionCount: number;
  complaintsAgainstCount: number;
  complaintsFiledCount: number;
  foodPreferences: string[];
  foodExceptions: string[];
  diets: string[];
  settings: { language: string; theme: string; pushNotificationsEnabled: boolean } | null;
}

export type ComplaintStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';
export type ComplaintTargetType = 'USER' | 'FOOD';

export interface Complaint {
  id: string;
  targetType: ComplaintTargetType;
  reason: string;
  status: ComplaintStatus;
  createdAt: string;
  resolvedAt: string | null;
  reporter: { id: string; username: string };
  targetUser: { id: string; username: string } | null;
  targetFood: { id: string; name: string } | null;
  resolvedByAdmin: { id: string; name: string } | null;
}
