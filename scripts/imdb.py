from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

def setup_driver():
    chrome_options = Options()
    # chrome_options.add_argument('--headless')  # Run in headless mode
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    driver = webdriver.Chrome(options=chrome_options)
    return driver

def get_imdb_cover_image(imdb_id):
    url = f"https://www.imdb.com/title/{imdb_id}/"    
    driver = None
    try:
        driver = setup_driver()
        driver.get(url)
        
        # Wait for the page to load completely
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.TAG_NAME, 'html'))
        )
        
        # Give some time for dynamic content to load
        time.sleep(2)
        
        # Method 1: Try to get the image from Open Graph meta tag
        try:
            meta_tag = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.XPATH, '//meta[@property="og:image"]'))
            )
            image_url = meta_tag.get_attribute('content')
            if image_url:
                return image_url
        except Exception as e:
            print(f"Could not find Open Graph image: {e}")
       
        return None
        
    except Exception as e:
        print(f"Error fetching IMDb page: {e}")
        return None
        
    finally:
        if driver:
            driver.quit()

if __name__ == "__main__":
    imdb_id = "tt26443597"
    image_url = get_imdb_cover_image(imdb_id)
    print(image_url)