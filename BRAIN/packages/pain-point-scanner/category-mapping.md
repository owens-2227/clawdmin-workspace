# Persona ↔ Subreddit Category Mapping — Account B

These persona categories are used to tag pain points for filtering on the shared dashboard. They follow the same system as Account A.

## Account B Categories

| Persona Category | Subreddits | Agent |
|-----------------|-----------|-------|
| Women's Hormonal Health | r/Menopause, r/Perimenopause, r/PCOS | tara-n |
| Plant-Based Diet | r/PlantBasedDiet | tara-n |
| Fitness | r/xxfitness | tara-n |
| Fermentation & Baking | r/sourdough, r/fermentation, r/Breadit | greg-h |
| Stay-at-Home Parents | r/SAHP | greg-h |
| Parenting | r/Parenting | greg-h |
| Sobriety & Recovery | r/stopdrinking | keisha-d |
| Coffee | r/Coffee | keisha-d |
| Running | r/ultrarunning, r/xxrunning | keisha-d |
| Self-Improvement | r/DecidingToBeBetter | keisha-d |
| Autoimmune & Thyroid | r/Hashimotos, r/Hypothyroidism, r/AutoimmuneProtocol | linda-f |
| Chronic Illness | r/ChronicIllness, r/Fibromyalgia | linda-f |
| Dog Training | r/reactivedogs, r/Dogtraining, r/BorderCollie | maya-r |
| Hiking & Outdoors | r/hiking, r/CampingGear | maya-r |
| Zero Waste & Sustainability | r/ZeroWaste, r/minimalism | sam-t |
| Container Gardening | r/ContainerGardening | sam-t |
| Gen Z & Young Adults | r/Adulting, r/BudgetFood, r/findapath | sam-t |
| Homesteading | r/BackyardChickens, r/homestead, r/vegetablegardening, r/seedsaving | diane-w |
| Canning & Preserving | r/Canning | diane-w |
| Divorce & Life Transitions | r/Divorce, r/LifeAfterDivorce | andrea-m |
| Dating | r/datingoverthirty | andrea-m |
| Gen Z & Young Adults | r/internetparents | andrea-m |
| Life Transitions | r/LifeAdvice | andrea-m |
| FIRE & Frugality | r/Fire, r/leanfire, r/povertyfinance | jordan-k |
| Gen Z & Young Adults | r/GenZ, r/CollegeRant, r/StudentLoans | jordan-k |
| Neurodivergent Women | r/ADHDwomen, r/AutisticAdults, r/AuDHD | simone-b |
| Fiber Arts | r/crochet, r/knitting | simone-b |

## Gen Z / Gen Alpha Expansion Slots

Sam T, Andrea M, and Jordan K each have 2 open slots. Recommended Gen Z/young adult subs to fill:

### For Jordan K (already 24, FIRE-focused, class-conscious):
- **r/GenZ** — general Gen Z culture, struggles, humor
- **r/CollegeRant** — college stress, tuition frustration, academic struggles

### For Sam T (26, zero waste, apartment living):
- **r/Adulting** — young adults figuring out life (taxes, insurance, cooking basics)
- **r/findapath** — career/life direction for young people

### For Andrea M (fill with younger-adjacent life transition subs):
- **r/internetparents** — young people seeking advice they can't get from family
- **r/LifeAdvice** — general life guidance, often younger posters

### Additional Gen Z subs to consider (assign to whoever fits best):
- r/jobs — entry-level job hunting frustrations
- r/StudentLoans — debt stress
- r/BudgetFood — eating well on nothing
- r/firsttimehomebuyer — "will I ever own a home" generation

## Persona Subreddit Records to Insert

These need to be inserted into the `persona_subreddits` collection in MongoDB so the dashboard auto-assigns personas correctly:

```python
new_mappings = [
    {"persona": "Women's Hormonal Health", "subreddit": "r/Menopause"},
    {"persona": "Women's Hormonal Health", "subreddit": "r/Perimenopause"},
    {"persona": "Plant-Based Diet", "subreddit": "r/PlantBasedDiet"},
    {"persona": "Fitness", "subreddit": "r/xxfitness"},
    {"persona": "Fermentation & Baking", "subreddit": "r/sourdough"},
    {"persona": "Fermentation & Baking", "subreddit": "r/fermentation"},
    {"persona": "Fermentation & Baking", "subreddit": "r/Breadit"},
    {"persona": "Stay-at-Home Parents", "subreddit": "r/SAHP"},
    {"persona": "Sobriety & Recovery", "subreddit": "r/stopdrinking"},
    {"persona": "Coffee", "subreddit": "r/Coffee"},
    {"persona": "Running", "subreddit": "r/ultrarunning"},
    {"persona": "Running", "subreddit": "r/xxrunning"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/Hashimotos"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/Hypothyroidism"},
    {"persona": "Autoimmune & Thyroid", "subreddit": "r/AutoimmuneProtocol"},
    {"persona": "Chronic Illness", "subreddit": "r/ChronicIllness"},
    {"persona": "Dog Training", "subreddit": "r/reactivedogs"},
    {"persona": "Dog Training", "subreddit": "r/Dogtraining"},
    {"persona": "Dog Training", "subreddit": "r/BorderCollie"},
    {"persona": "Hiking & Outdoors", "subreddit": "r/hiking"},
    {"persona": "Zero Waste & Sustainability", "subreddit": "r/ZeroWaste"},
    {"persona": "Zero Waste & Sustainability", "subreddit": "r/minimalism"},
    {"persona": "Container Gardening", "subreddit": "r/ContainerGardening"},
    {"persona": "Homesteading", "subreddit": "r/BackyardChickens"},
    {"persona": "Homesteading", "subreddit": "r/homestead"},
    {"persona": "Homesteading", "subreddit": "r/vegetablegardening"},
    {"persona": "Homesteading", "subreddit": "r/seedsaving"},
    {"persona": "Canning & Preserving", "subreddit": "r/Canning"},
    {"persona": "Divorce & Life Transitions", "subreddit": "r/Divorce"},
    {"persona": "Divorce & Life Transitions", "subreddit": "r/LifeAfterDivorce"},
    {"persona": "Dating", "subreddit": "r/datingoverthirty"},
    {"persona": "FIRE & Frugality", "subreddit": "r/Fire"},
    {"persona": "FIRE & Frugality", "subreddit": "r/leanfire"},
    {"persona": "FIRE & Frugality", "subreddit": "r/povertyfinance"},
    {"persona": "Neurodivergent Women", "subreddit": "r/ADHDwomen"},
    {"persona": "Neurodivergent Women", "subreddit": "r/AutisticAdults"},
    {"persona": "Neurodivergent Women", "subreddit": "r/AuDHD"},
    {"persona": "Fiber Arts", "subreddit": "r/crochet"},
    {"persona": "Fiber Arts", "subreddit": "r/knitting"},
    # Expansion subs
    {"persona": "Women's Hormonal Health", "subreddit": "r/PCOS"},
    {"persona": "Parenting", "subreddit": "r/Parenting"},
    {"persona": "Self-Improvement", "subreddit": "r/DecidingToBeBetter"},
    {"persona": "Chronic Illness", "subreddit": "r/Fibromyalgia"},
    {"persona": "Hiking & Outdoors", "subreddit": "r/CampingGear"},
    # Gen Z & Young Adults
    {"persona": "Gen Z & Young Adults", "subreddit": "r/GenZ"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/CollegeRant"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/StudentLoans"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/Adulting"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/BudgetFood"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/findapath"},
    {"persona": "Gen Z & Young Adults", "subreddit": "r/internetparents"},
    {"persona": "Life Transitions", "subreddit": "r/LifeAdvice"},
]
```
