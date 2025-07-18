import pandas as pd

# File path
file_path = "C:/Users/suman/OneDrive/Documents/movieee/csv/Credit+Card+Products 17 july.csv"

# Load CSV
df = pd.read_csv(file_path)

# Define network columns
network_cols = ['Network 1', 'Network 2', 'Network 3', 'Network 4']

# Condition 1: 'visa' in any network column (case-insensitive)
visa_mask = df[network_cols].apply(lambda col: col.str.lower().str.contains('visa signature', na=False)).any(axis=1)

# Condition 2: 'canara' in the Bank column (case-insensitive)
canara_mask = df['Bank'].str.lower().str.contains('icici', na=False)

# Combine both conditions
final_mask = visa_mask & canara_mask

# Get matching credit cards
matching_cards = df.loc[final_mask, 'Credit Card Name'].unique()

# Output
print("Matching Credit Cards with both 'Visa' and 'Canara':")
for card in matching_cards:
    print("", card, "(Visa Signature)")
