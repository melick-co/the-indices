"""Extract every workbook dataset into tidy (metric, entity, period, value) rows + metric provenance."""
import json, csv, os

ISO = {'Australia':'AUS','Austria':'AUT','Belgium':'BEL','Canada':'CAN','Chile':'CHL','Colombia':'COL',
'Costa Rica':'CRI','Czechia':'CZE','Denmark':'DNK','Estonia':'EST','Finland':'FIN','France':'FRA',
'Germany':'DEU','Greece':'GRC','Hungary':'HUN','Iceland':'ISL','Ireland':'IRL','Israel':'ISR','Italy':'ITA',
'Japan':'JPN','Korea':'KOR','Latvia':'LVA','Lithuania':'LTU','Luxembourg':'LUX','Mexico':'MEX',
'Netherlands':'NLD','New Zealand':'NZL','Norway':'NOR','Poland':'POL','Portugal':'PRT','Slovak Republic':'SVK',
'Slovenia':'SVN','Spain':'ESP','Sweden':'SWE','Switzerland':'CHE','Turkiye':'TUR','Türkiye':'TUR',
'United Kingdom':'GBR','United States':'USA'}
NAME={v:k for k,v in ISO.items() if k not in ('Türkiye',)}

metrics=[]   # metric metadata
obs=[]       # tidy observations

def add_metric(mid, name, unit, basis, direction, tier, org, dataset, url, published, period, category):
    metrics.append(dict(metric_id=mid,name=name,unit=unit,basis=basis,direction=direction,
        source_tier=tier,source_org=org,source_dataset=dataset,source_url=url,
        source_published=published,period=period,category=category))

def add_obs(mid, data, period, status='published'):
    for country,val in data.items():
        if val is None: continue
        code = ISO.get(country, country if len(country)==3 else None)
        if code is None: continue
        obs.append(dict(metric_id=mid,entity=code,period=str(period),value=float(val),status=status))

# ---------- TAX AT AVERAGE WAGE ----------
oecd={'AUS':(23.5,0.0,5.7,29.2),'AUT':(11.7,14.1,21.7,47.2),'BEL':(20.4,11.0,21.3,52.7),'CAN':(17.6,5.8,8.4,31.9),
'CHL':(0.1,7.0,0.0,7.1),'COL':(0.0,0.0,0.0,0.0),'CRI':(0.0,8.5,20.1,28.6),'CZE':(6.7,8.2,25.3,40.2),
'DNK':(35.8,0.0,0.6,36.4),'EST':(12.9,1.2,25.3,39.4),'FIN':(17.4,8.7,17.5,43.5),'FRA':(11.9,8.3,26.6,46.8),
'DEU':(14.1,17.1,16.7,47.9),'GRC':(8.9,11.3,18.2,38.5),'HUN':(13.3,16.4,11.5,41.2),'ISL':(25.6,0.1,6.0,31.7),
'IRL':(21.6,3.6,10.0,35.1),'ISR':(10.2,7.6,5.4,23.2),'ITA':(16.8,4.3,24.0,45.1),'JPN':(6.8,12.7,13.5,33.0),
'KOR':(6.2,8.5,10.0,24.6),'LVA':(13.5,8.5,19.1,41.1),'LTU':(18.0,19.2,1.8,38.9),'LUX':(18.4,10.8,12.2,41.3),
'MEX':(8.6,1.2,10.1,20.0),'NLD':(14.6,9.8,10.7,35.1),'NZL':(21.1,0.0,0.0,21.1),'NOR':(17.9,7.0,11.5,36.4),
'POL':(4.9,15.3,14.1,34.3),'PRT':(14.2,8.9,19.2,42.3),'SVK':(8.4,10.3,22.9,41.6),'SVN':(10.4,19.0,13.9,43.3),
'ESP':(12.0,4.9,23.3,40.2),'SWE':(12.9,5.3,23.9,42.1),'CHE':(11.4,6.0,6.0,23.5),'TUR':(10.7,12.8,14.9,38.4),
'GBR':(13.3,8.0,10.1,31.3),'USA':(15.3,7.1,7.5,29.9)}
wage={'CHE':102611,'LUX':90384,'DNK':88971,'DEU':88144,'BEL':86545,'IRL':86235,'NLD':85877,'AUT':83716,
'NOR':82016,'ISL':78723,'GBR':78216,'CAN':75586,'AUS':72330,'KOR':70766,'USA':70627,'FIN':68073,'FRA':67318,
'SWE':63934,'ITA':58772,'JPN':58439,'NZL':54733,'ISR':54308,'ESP':53185,'LTU':52459,'POL':50089,'SVN':48780,
'GRC':47454,'HUN':46169,'TUR':44881,'CZE':43114,'PRT':41294,'EST':39686,'LVA':39483,'SVK':35026,'CHL':31076,
'CRI':29386,'COL':20293,'MEX':19311}
eff={c:round((v[0]+v[1])/(100-v[2])*100,2) for c,v in oecd.items()}
netkept_pct={c:round(100-v[3],1) for c,v in oecd.items()}
add_metric('avg_wage_ppp','Average annual gross wage','USD PPP','PPP-adjusted, 2024','higher_is_less_pressure',1,
 'OECD','Pensions at a Glance 2025','https://data-explorer.oecd.org/','2025','2024','income')
add_metric('effective_tax_rate','Effective tax on the average wage (income tax + employee SSC)','percent',
 'Share of gross wage','higher_is_more_pressure',1,'OECD','Taxing Wages 2024','https://data.oecd.org/tax/','2025','2023','tax')
add_metric('net_kept_pct','Net kept as share of total labour cost','percent','100 minus tax wedge',
 'higher_is_less_pressure',1,'OECD','Taxing Wages 2024','https://data.oecd.org/tax/','2025','2023','tax')
add_obs('avg_wage_ppp',{NAME[c]:wage[c] for c in wage},'2024')
add_obs('effective_tax_rate',{NAME[c]:eff[c] for c in eff},'2023')
add_obs('net_kept_pct',{NAME[c]:netkept_pct[c] for c in netkept_pct},'2023')

# ---------- HOUSEHOLD / HOME (already in the-indices) ----------
ppsm={'CHE':19882,'KOR':13569,'LUX':11525,'ISR':10912,'AUS':7467,'AUT':7347,'NLD':6825,'NOR':6784,'DEU':6255,
'DNK':6224,'NZL':5683,'GBR':5663,'FRA':5642,'CZE':5607,'JPN':5564,'SWE':5404,'FIN':5115,'IRL':5067,'CAN':4693,
'SVN':4554,'BEL':4440,'ESP':4349,'EST':4144,'PRT':4051,'HUN':3901,'POL':3855,'ITA':3775,'LTU':3744,'SVK':3549,
'USA':3321,'GRC':3178,'MEX':2674,'LVA':2660,'CHL':2490,'CRI':2424,'COL':1907,'TUR':1737}
def y2b(c):
    if c not in ppsm or c not in oecd: return None
    lc=wage[c]/(1-oecd[c][2]/100); nk=lc*(1-oecd[c][3]/100); return round(ppsm[c]*90/nk,2)
add_metric('years_to_buy_home','Years of net income to buy a 90m2 home','years',
 'Home price market USD, income PPP USD (mixed)','higher_is_more_pressure',3,
 'Derived (Numbeo; OECD)','Composite','https://www.numbeo.com/','2026','2026','housing')
add_metric('home_price_90m2','Average home price, 90m2 city-centre apartment','USD','Market USD',
 'higher_is_more_pressure',3,'Numbeo','Property Prices','https://www.numbeo.com/','2026','2026','housing')
add_obs('years_to_buy_home',{NAME[c]:y2b(c) for c in ppsm},'2026',status='derived')
add_obs('home_price_90m2',{NAME[c]:ppsm[c]*90 for c in ppsm},'2026',status='derived')

hh_debt={'NOR':236,'CHE':224,'AUS':223,'NLD':213,'DNK':203,'LUX':184,'KOR':180,'SWE':180,'CAN':175,'FIN':143,
'GBR':131,'JPN':127,'FRA':115,'BEL':106,'PRT':103,'IRL':100,'USA':100,'DEU':86,'SVK':79,'ESP':77}
real_wage={'LVA':76.8,'LTU':66.6,'ISL':40.4,'EST':40.1,'POL':37.9,'HUN':30.6,'SVN':25.4,'CZE':21.4,'NZL':20.7,
'SVK':20.7,'ISR':18.9,'KOR':18.4,'USA':16.1,'LUX':15.5,'DEU':13.5,'SWE':12.3,'CAN':11.2,'NOR':11.0,'DNK':9.7,
'CHE':8.2,'AUS':6.0,'PRT':5.9,'MEX':5.7,'BEL':5.3,'AUT':5.1,'FRA':4.7,'GBR':4.0,'FIN':2.1,'JPN':0.1,'ESP':-2.8,
'NLD':-5.1,'IRL':-6.1,'ITA':-7.1,'GRC':-21.2}
savings={'SWE':16.0,'HUN':14.3,'CZE':13.7,'FRA':12.8,'AUT':11.7,'DEU':11.2,'NLD':9.5,'ESP':9.2,'IRL':9.0,
'DNK':8.5,'MEX':8.1,'BEL':6.6,'POL':6.1,'AUS':6.1,'LUX':5.0,'CAN':5.0,'USA':4.9,'KOR':4.8,'GBR':4.7,'PRT':4.5,
'FIN':4.3,'NOR':4.2,'ITA':4.2,'LTU':3.8,'EST':3.0,'JPN':0.9,'LVA':0.0,'NZL':-1.3}
add_metric('household_debt_to_income','Household debt to net disposable income','percent','National currency ratio',
 'higher_is_more_pressure',1,'OECD','Household debt','https://data.oecd.org/hha/household-debt.htm','2025','2024','household')
add_metric('real_wage_growth','Real wage growth 2010-2024','percent','Real, constant prices',
 'higher_is_less_pressure',1,'OECD','Average annual wages','https://data-explorer.oecd.org/','2025','2010-2024','income')
add_metric('household_savings_rate','Household net savings rate','percent','Share of disposable income',
 'higher_is_less_pressure',1,'OECD','Household savings','https://data.oecd.org/hha/household-savings.htm','2025','2024','household')
add_obs('household_debt_to_income',{NAME[c]:hh_debt[c] for c in hh_debt},'2024')
add_obs('real_wage_growth',{NAME[c]:real_wage[c] for c in real_wage},'2024')
add_obs('household_savings_rate',{NAME[c]:savings[c] for c in savings},'2024')

# ---------- BONDS / DEBT ----------
yld={'AUS':4.24,'AUT':2.87,'BEL':2.95,'CAN':3.21,'CHL':5.71,'COL':10.91,'CZE':4.25,'DNK':2.58,'EST':3.51,
'FIN':2.72,'FRA':2.91,'DEU':2.60,'GRC':3.42,'HUN':6.62,'ISR':4.35,'ITA':3.46,'JPN':1.44,'KOR':2.81,'LVA':3.45,
'LTU':3.55,'LUX':2.89,'MEX':9.03,'NLD':2.62,'NZL':4.50,'NOR':3.62,'POL':5.59,'PRT':3.25,'SVK':3.06,'SVN':3.01,
'ESP':3.11,'SWE':2.41,'CHE':0.60,'GBR':4.50,'USA':4.20}
infl={'AUS':3.8,'AUT':2.9,'BEL':2.6,'CAN':2.4,'CHL':4.2,'COL':5.2,'CRI':1.0,'CZE':2.5,'DNK':1.8,'EST':4.6,
'FIN':1.7,'FRA':1.3,'DEU':2.2,'GRC':2.9,'HUN':4.6,'ISL':4.2,'IRL':2.0,'ISR':2.5,'ITA':1.6,'JPN':2.9,'KOR':2.1,
'LVA':3.9,'LTU':3.5,'LUX':2.3,'MEX':3.8,'NLD':2.9,'NZL':2.5,'NOR':3.0,'POL':3.0,'PRT':2.3,'SVK':4.1,'SVN':2.3,
'ESP':2.7,'SWE':1.1,'CHE':0.2,'TUR':32.9,'GBR':3.5,'USA':2.9}
add_metric('bond_yield_10y','10-year government bond yield','percent','Nominal, Sep 2025','higher_is_more_pressure',
 2,'World Government Bonds','Sovereign yields','https://www.worldgovernmentbonds.com/','2025','2025-09','sovereign')
add_metric('inflation_rate','Consumer price inflation','percent','Annual, to Dec 2025','higher_is_more_pressure',
 1,'OECD / national','CPI','https://data.oecd.org/price/inflation-cpi.htm','2026','2025','prices')
add_obs('bond_yield_10y',{NAME[c]:yld[c] for c in yld},'2025-09')
add_obs('inflation_rate',{NAME[c]:infl[c] for c in infl},'2025')

# ---------- PRODUCTIVITY ----------
prodlvl={'IRL':149.31,'NOR':132.28,'LUX':126.45,'CHE':100.63,'BEL':100.33,'DNK':99.23,'USA':97.05,'AUT':94.96,
'NLD':94.38,'DEU':93.81,'SWE':89.22,'FRA':88.15,'AUS':83.66,'FIN':82.96,'GBR':78.05,'ITA':77.09,'CAN':73.44,
'ESP':73.42,'SVN':65.50,'ISR':60.51,'CZE':60.48,'LTU':60.37,'SVK':60.13,'PRT':59.25,'JPN':56.26,'LVA':55.88,
'NZL':55.42,'HUN':54.74,'KOR':54.64,'POL':54.28,'EST':53.38,'GRC':44.78,'CHL':36.51,'CRI':31.84,'MEX':24.97,'COL':21.35}
pidx={'AUS':(92.2,103.1),'AUT':(95.6,103.7),'BEL':(96.4,104.0),'CAN':(94.7,111.4),'CHL':(89.6,119.4),
'COL':(89.0,134.2),'CRI':(86.9,128.1),'CZE':(91.7,107.8),'DNK':(94.2,107.7),'EST':(95.2,119.5),'FIN':(98.9,103.3),
'FRA':(95.7,103.5),'DEU':(94.9,104.0),'GRC':(112.8,99.0),'HUN':(97.5,112.1),'ISL':(96.1,108.8),'IRL':(78.8,122.4),
'ISR':(92.5,115.1),'ITA':(98.9,103.0),'JPN':(94.1,104.5),'KOR':(90.4,117.6),'LVA':(87.4,116.1),'LTU':(88.0,119.5),
'LUX':(101.4,101.1),'MEX':(94.4,98.2),'NLD':(97.1,98.8),'NZL':(94.3,101.3),'NOR':(97.2,102.7),'POL':(91.3,119.6),
'PRT':(97.2,103.2),'SVK':(89.7,112.7),'SVN':(96.4,111.5),'ESP':(94.3,101.0),'SWE':(95.0,103.3),'CHE':(97.8,107.0),
'TUR':(83.6,122.0),'GBR':(97.7,104.6),'USA':(98.2,106.3)}
prodcagr={c:round(((b/a)**(1/10)-1)*100,2) for c,(a,b) in pidx.items()}
add_metric('productivity_level','GDP per hour worked','USD PPP','2023, constant PPP','higher_is_less_pressure',
 1,'OECD','Productivity','https://data.oecd.org/lprdty/','2025','2023','productivity')
add_metric('productivity_growth_10y','Labour productivity growth, 10-year CAGR','percent per year',
 '2010-2020','higher_is_less_pressure',1,'OECD','Productivity Database','https://data.oecd.org/lprdty/','2025','2010-2020','productivity')
add_obs('productivity_level',{NAME[c]:prodlvl[c] for c in prodlvl},'2023')
add_obs('productivity_growth_10y',{NAME[c]:prodcagr[c] for c in prodcagr},'2020')

# ---------- PRICES ----------
petrol={'ISR':2.855,'DNK':2.758,'NLD':2.748,'FIN':2.462,'GRC':2.455,'CHE':2.438,'FRA':2.382,'NOR':2.350,
'PRT':2.323,'DEU':2.297,'ITA':2.269,'BEL':2.239,'LVA':2.151,'GBR':2.123,'EST':2.119,'IRL':2.119,'AUT':2.108,
'LUX':2.100,'LTU':2.092,'SVK':2.086,'CZE':2.040,'NZL':2.017,'SWE':2.000,'SVN':1.976,'HUN':1.952,'ISL':1.806,
'ESP':1.812,'POL':1.769,'CHL':1.742,'MEX':1.637,'CRI':1.607,'CAN':1.555,'KOR':1.529,'TUR':1.407,'AUS':1.30,
'JPN':1.20,'COL':1.00,'USA':0.95}
col_index={'CHE':110.7,'ISL':97.2,'NOR':83.7,'ISR':79.7,'DNK':78.9,'LUX':78.0,'NLD':73.4,'AUT':71.3,'IRL':70.6,
'FIN':69.0,'USA':68.8,'DEU':68.7,'BEL':68.6,'SWE':68.0,'AUS':67.9,'GBR':67.8,'FRA':67.7,'CAN':63.0,'KOR':61.6,
'ITA':61.4,'NZL':60.3,'EST':59.7,'SVN':54.1,'GRC':54.0,'CZE':53.0,'CRI':52.9,'LVA':52.3,'ESP':51.6,'LTU':51.2,
'SVK':49.6,'PRT':48.8,'JPN':47.5,'POL':47.3,'HUN':46.9,'MEX':42.6,'TUR':39.2,'CHL':39.0,'COL':31.7}
add_metric('petrol_price','Petrol (Octane-95) price','USD per litre','May 2026, market USD','higher_is_more_pressure',
 2,'GlobalPetrolPrices','Gasoline prices','https://www.globalpetrolprices.com/','2026','2026-05','prices')
add_metric('cost_of_living_index','Cost of living index','index (NYC=100)','Crowd-sourced basket',
 'higher_is_more_pressure',3,'Numbeo','Cost of Living Index','https://www.numbeo.com/','2026','2026','prices')
add_obs('petrol_price',{NAME[c]:petrol[c] for c in petrol},'2026')
add_obs('cost_of_living_index',{NAME[c]:col_index[c] for c in col_index},'2026',status='derived')

# ---------- GDP / MARKET ----------
mkt={'USA':216.3,'CHE':210.5,'JPN':156.7,'CAN':150.4,'AUS':98.9,'KOR':83.0,'CHL':79.3,'ISR':61.2,'LUX':44.9,
'ESP':43.7,'DEU':43.6,'NZL':35.7,'GRC':32.5,'TUR':27.9,'AUT':22.6,'POL':21.5,'HUN':18.7,'COL':17.3,'SVN':15.7,'CZE':10.0}
gdppc={'LUX':135000,'IRL':107000,'CHE':105000,'NOR':92000,'USA':86600,'ISL':85000,'DNK':73000,'NLD':72000,
'AUS':66000,'AUT':59000,'SWE':59000,'DEU':55500,'BEL':57000,'FIN':56000,'CAN':54000,'ISR':56000,'GBR':52000,
'NZL':50000,'FRA':47000,'ITA':41000,'KOR':37000,'JPN':33900,'ESP':36000,'SVN':35000,'CZE':32000,'EST':31500,
'PRT':30000,'LTU':30000,'LVA':25000,'GRC':24500,'SVK':26000,'HUN':24000,'POL':25500,'CHL':17500,'CRI':18000,
'TUR':16500,'MEX':14000,'COL':8200}
add_metric('market_cap_gdp','Stock market capitalisation','percent of GDP','Listed domestic companies, 2024',
 'higher_is_less_pressure',1,'World Bank','WDI CM.MKT.LCAP.GD.ZS','https://data.worldbank.org/','2025','2024','markets')
add_metric('gdp_per_capita','GDP per capita','USD','Nominal, 2025','higher_is_less_pressure',1,
 'IMF','World Economic Outlook','https://www.imf.org/en/Publications/WEO','2025','2025','economy')
add_obs('market_cap_gdp',{NAME[c]:mkt[c] for c in mkt},'2024')
add_obs('gdp_per_capita',{NAME[c]:gdppc[c] for c in gdppc},'2025')

# ---------- IMMIGRATION (annual series) ----------
series={'USA':(1031.0,581.5,835.4,1048.7,1190.2,1425.1),'DEU':(643.3,521.1,533.1,669.0,664.3,586.2),
'CAN':(341.2,184.5,406.0,437.6,471.7,483.6),'GBR':(356.1,199.9,369.2,488.0,743.1,435.7),
'ESP':(244.6,178.6,261.4,323.2,374.9,368.0),'FRA':(284.5,228.0,276.6,305.9,306.2,298.1),
'AUS':(195.6,158.9,170.4,170.9,238.7,239.3),'NLD':(165.7,134.2,172.4,205.9,195.9,183.4),
'JPN':(137.6,83.6,56.8,144.5,163.1,177.1),'ITA':(167.1,112.0,204.4,235.4,201.6,168.9),
'PRT':(106.7,84.7,93.7,121.0,140.3,137.6),'CHE':(106.5,102.3,109.1,130.0,144.5,135.6),
'BEL':(95.0,78.8,95.0,102.9,106.1,106.2),'AUT':(84.4,65.6,76.5,93.3,105.4,102.6),
'KOR':(72.5,53.0,48.2,57.8,87.1,75.6),'SWE':(99.3,80.9,75.9,89.8,87.1,75.6),'MEX':(40.5,58.4,67.7,75.6,69.9,72.5),
'IRL':(48.6,42.7,38.4,66.9,65.6,71.9),'DNK':(45.8,37.8,48.9,62.9,57.4,54.4),'NZL':(38.1,35.7,35.4,154.3,119.4,53.0),
'CZE':(62.3,55.6,63.9,45.6,37.5,40.2),'ISR':(33.2,19.7,25.5,74.7,46.0,39.7),'NOR':(46.1,32.8,38.1,42.5,41.7,35.7),
'FIN':(28.1,24.2,30.8,40.4,42.8,34.7),'LUX':(24.5,20.1,24.3,27.2,27.4,26.4),'SVN':(35.9,22.9,30.0,33.2,31.3,26.4),
'SVK':(26.8,17.1,26.8,24.3,24.3,20.9),'EST':(10.4,9.1,11.8,14.2,12.5,8.9),'LTU':(2.9,2.8,5.9,10.7,7.0,5.7),
'POL':(163.2,163.5,224.2,335.3,374.1,373.3),'CHL':(254.1,154.6,76.5,198.4,70.5,112.2),
'GRC':(95.4,63.4,28.7,64.1,71.7,64.7),'COL':(225.8,74.8,40.7,108.1,49.9,61.8),'HUN':(55.3,43.8,49.1,55.5,61.3,49.3),
'ISL':(10.7,8.9,10.0,17.0,16.6,14.8),'CRI':(7.8,None,9.1,11.2,10.2,11.6),'LVA':(6.6,4.6,5.9,7.3,2.7,2.7)}
YEARS=[2019,2020,2021,2022,2023,2024]
add_metric('permanent_migration_inflow','Permanent migration inflow','thousands',
 'Foreign nationals, incl. status changes','neutral',1,'OECD','International Migration Outlook 2025 Table 1.1',
 'https://data-explorer.oecd.org/s/31n','2025','2019-2024','migration')
for c,vals in series.items():
    for yr,v in zip(YEARS,vals):
        if v is None: continue
        obs.append(dict(metric_id='permanent_migration_inflow',entity=c,period=str(yr),value=float(v),status='published'))

# ---------- WRITE ----------
os.makedirs('data',exist_ok=True)
json.dump(metrics,open('data/metrics.json','w'),indent=2)
json.dump(obs,open('data/observations.json','w'),indent=2)
ents=sorted(set(o['entity'] for o in obs))
json.dump([{'code':e,'name':NAME.get(e,e)} for e in ents],open('data/entities.json','w'),indent=2)

with open('data/observations.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['metric_id','entity','period','value','status']); w.writeheader(); w.writerows(obs)

print(f"metrics: {len(metrics)}  entities: {len(ents)}  observations: {len(obs)}")
from collections import Counter
cat=Counter(m['category'] for m in metrics)
print("categories:",dict(cat))
print("periods for migration:",sorted(set(o['period'] for o in obs if o['metric_id']=='permanent_migration_inflow')))
