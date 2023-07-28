import requests
from bs4 import BeautifulSoup
import os, time
import json, re

os.chdir(os.path.split(__file__)[0])

def update_docs():
    keywords = [k.strip() for k in open('help.eviews.com_list.txt').readlines()]
    if not os.path.exists('pages'):
        os.makedirs('pages')
    docs = {}
    lookups = {}
    grp = ''
    for k in keywords:
        kwd, uri = k.split(': ', 2)
        kwd = kwd.strip()
        if kwd.startswith('[') and kwd.endswith(']'):
            grp = kwd[1:-1]
            lookups[grp] = {}
        try:
            uri, anchor = uri.strip().rsplit('.html#', 2)
        except ValueError:
            uri = uri.strip()
            anchor = ''
        uri = uri.replace('.html','')
        url = 'https://help.eviews.com/content/'+uri+'.html'

        if grp!='':
            lookups[grp][kwd] = dict(uri=uri, anchor=anchor)
        print(grp, kwd, uri, anchor, uri in docs)
        if uri in docs: continue
        print('READING PAGE',url)
        i=0
        while True:
            try:
                if os.path.exists(f'pages/{uri}.html'):
                    print('using existing',uri)
                    html = open(f'pages/{uri}.html','r', encoding='utf-8').read()
                    soup = BeautifulSoup(html, features="html.parser")
                    docs[uri] = soup.prettify()
                    break
                else:
                    html = requests.get(url).text
                    soup = BeautifulSoup(html, features="html.parser")
                    print(uri, len(html), 'bytes')
                    print(soup.text[:200])
                    for data in soup(['style', 'script']):
                        # Remove tags
                        data.decompose()
                    docs[uri] = soup.prettify()
                    print('writing',uri)
                    try:
                        open(f'pages/{uri}.html','w', encoding='utf-8').write(soup.prettify())
                    except:
                        import pdb
                        pdb.set_trace()
                    time.sleep(2)
                    break
            except:
                if i>3:
                    docs[url] = 'ERROR'
                    print(f'{kwd} Skipping')
                    break
                i+=1
                print(f'{kwd} Error -- sleeping {10*i}s')
                time.sleep(10*i)
        print('='*40)

    json.dump(docs, open('docpacket.json','w', encoding='utf-8'))
    json.dump(lookups, open('keywords.json','w', encoding='utf-8'))

def strip_image(tag):
    img = tag.find('img', class_="Default EquationGraphic")
    while img!=None:
        txt = img["src"]
        img.replace_with(f'[img:{txt}]')
        img = tag.find('img', class_="Default EquationGraphic")

def get_text(tag):
    return ' '.join([c for c in tag.stripped_strings])

def annotate_keywords():
    keywords = json.load(open(r"keywords.json"))
    pages = json.load(open(r"docpacket.json"))

    for grp in keywords:
        for kw in keywords[grp]:
            kwinfo = keywords[grp][kw]
            res = BeautifulSoup(pages[kwinfo['uri']]).body
            strip_image(res)
            if kwinfo['anchor']!='':
                res = res.find(id=kwinfo['anchor'])
                if res==None:
                    print('*', grp, kw, 'ERROR - ANCHOR NOT FOUND', kwinfo)
                    continue
                parent = res.find_parent('td')
                if parent!=None: #DOCTYPE A1: this looks like function docs on one row of a 3 col table
                    res = parent
                    attribs = ['usage','description','long_description']
                    table = res.find_parent('table')
                    if table!=None and 'Function_3col_2desc' in table['class']:
                        step = res.find_previous_sibling()
                        if step!=None:
                            res = step
                        attribs = ['description','usage','long_description']
                    if table!=None and 'Mathapp' in table['class']:
                        attribs = ['usage','description']
                    for a in attribs:
                        kwinfo[a] = get_text(res)
                        res = res.find_next_sibling()
                        if res==None: break
                    print('*', grp, kw, *[f'{a}={kwinfo[a]}' for a in kwinfo])
                    continue
                if res.has_attr("class") and "Object_Reference" in res['class']: #DOCTYPE A2: this looks like short object property docs in a div ##TODO: Seek back to the class_="Object_Subsection" and get the text with the type
                    cs = res.find(class_="Command_Summary")
                    if cs!=None:
                        text = get_text(res)
                        m = re.match(rf'^({kw}(\(.*?\))?)\s*(.*)', text, re.IGNORECASE)
                        if m!=None:
                            kwinfo['usage'] = m.group(1)
                            kwinfo['description'] = m.group(3)
                        else:
                            print('*', grp, kw, 'BAD MATCH:', text)
                            continue
                    print('*', grp, kw, *[f'{a}={kwinfo[a]}' for a in kwinfo])
                    continue

            res0 = res
            res = res.find(class_=["Command_Title_Box","Object_Section","Object_Description"])
            if res == None:
                print('*', grp, kw, 'ERROR - NO MATCHING PATTERN', kwinfo)
            elif "Command_Title_Box" in res["class"]: #DOCTYPE B: this looks like a command description doc
                res = res.find_next_sibling() #Div with Table data for command_title_box -- skip it
                long_doc = []
                while res!=None:
                    res = res.find_next_sibling()
                    if res==None or res.name=='footer':
                        break
                    elif res.has_attr("class") and ("Command_Section" in res['class'] or "Object_Section" in res['class']):
                        if res==None or get_text(res).strip().lower()!='syntax': break
                        #skip this entry otherwise
                    elif res.has_attr("class") and ("Program_Syntax" in res['class'] or "Command_Type" in res['class'] or 
                                                    "Command_Types" in res['class'] or "Command_Types_Tabbed" in res['class']): 
                        kwinfo['usage'] = kwinfo['usage']+'\n'+get_text(res) if 'usage' in kwinfo else get_text(res)
                    else: long_doc.append(get_text(res))
                if len(long_doc)>0:
                    kwinfo['description'] = long_doc[0]
                if len(long_doc)>1:
                    kwinfo['long_description'] = '\n'.join(long_doc[1:])
                if res!=None and res.text.lower().strip()!='options':
                    options = {} ##TODO: There can be more than one table.
                    res = res.find('table', class_="Options_Table")
                    if res!=None:
                        res = res.find('tr')            
                        while res!=None:
                            opt = get_text(res.children[0])
                            text = get_text(res.children[1])
                            options[opt] = text
                            res = res.find_next_sibling()
                        if(len(kwinfo)>0):
                            kwinfo['options'] = options
                print('*', grp, kw, *[f'{a}={kwinfo[a]}' for a in kwinfo])
            elif "Object_Section" in res["class"] or "Object_Description" in res["class"]: #DOCTYPE C: this looks like Object documentation
                kwinfo['description'] = get_text(res)
                res = res.find(class_='Object_Reference')
                long_doc = []
                while res!=None:
                    res = res.find_next_sibling() #Note that we skip the first line of text because it is just a link to the usage documenation
                    if res==None or res.has_attr("class") and "Command_Section" in res["class"]: break
                    long_doc.append(get_text(res))
                if len(long_doc)>0:
                    kwinfo['long_description'] = '\n'.join(long_doc)
                print('*', grp, kw, *[f'{a}={kwinfo[a]}' for a in kwinfo])
    json.dump(keywords, open("keywords_detail.json", "w"))
    json.dump(keywords, open("../resources/keywords_detail.json", "w"))

if __name__=='__main__':
    update_docs() #TODO: add option to clear out web page cache
    annotate_keywords()