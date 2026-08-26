import type { Company } from '../types';

export interface CompanyDefinition {
  company: Company;
  aliases: readonly string[];
  symbols: readonly string[];
  currency: 'USD';
  tier: 'SNRFOR';
  restructuring: 'XR14';
  couponBp: number;
}

const definition = (value: CompanyDefinition): CompanyDefinition => Object.freeze({
  ...value,
  aliases: Object.freeze([...value.aliases]),
  symbols: Object.freeze([...value.symbols]),
});

// This order and every contract field intentionally mirror server/lib/iceCdsRegistry.js.
export const ICE_CDS_CONTRACT_REGISTRY: readonly CompanyDefinition[] = Object.freeze([
  definition({ company: 'Oracle', aliases: ['ORACLE COP', 'ORACLE CORP', 'ORACLE CORPORATION'], symbols: ['ORCLE', 'ORCL'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
  definition({ company: 'CoreWeave', aliases: ['COREWEAVE', 'COREWEAVE INC', 'COREWEAVE, INC.'], symbols: ['COREWEI', 'CRWV'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 500 }),
  definition({ company: 'NVIDIA', aliases: ['NVIDIA CORP', 'NVIDIA CORPORATION'], symbols: ['NVIDIA', 'NVDA'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
  definition({ company: 'Amazon', aliases: ['AMAZON COM INC', 'AMAZON.COM INC', 'AMAZON INC'], symbols: ['AMZN'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
  definition({ company: 'Google', aliases: ['ALPHABET INC', 'ALPHABET, INC.', 'GOOGLE INC', 'GOOGLE LLC'], symbols: ['ALPHINC', 'GOOG', 'GOOGL'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
  definition({ company: 'Microsoft', aliases: ['MICROSOFT CORP', 'MICROSOFT CORPORATION'], symbols: ['MSFT'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
  definition({ company: 'Meta', aliases: ['META PLATFORMS INC', 'META PLATFORMS, INC.', 'META PLATFORMS'], symbols: ['METAPL', 'META'], currency: 'USD', tier: 'SNRFOR', restructuring: 'XR14', couponBp: 100 }),
]);

export const TRACKED_COMPANIES: readonly Company[] = Object.freeze(
  ICE_CDS_CONTRACT_REGISTRY.map(({ company }) => company),
);
